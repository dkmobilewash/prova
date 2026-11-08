"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { extractSpecTrade, SPEC_TRADE_PROMPT_VERSION, type SpecTradeRead } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { aiGate } from "@/lib/ai/settings";
import { recordAskUsage } from "@/lib/ask/usage";
import { claimSpecPages, markSpecFailure, releaseSpecPages } from "@/lib/ask/specSpend";
import { isProviderOutage } from "@/lib/ai/providerOutage";
import { documentDisplayFileName, documentUrlProblem } from "@/lib/document-uploads";
import { readJobFileBytes } from "@/lib/plan-ingest/planBytes";
import { findSpecSections } from "@/lib/specs/specBookSections";
import { pdfPageLines, sectionPdf } from "@/lib/specs/sectionBytes";
import { quoteIsInDocument } from "@/lib/specs/quoteMatch";
import { actionFail, actionOk, type ActionResult, type ActionResultWith } from "@/lib/actions/shared";

/**
 * ── A WHOLE SPEC BOOK ON A JOB: stored, split into the trade's sections, read ──
 *
 * Three steps a person sees as one: the book is recorded (uploaded to the job's
 * plan-set path, so it shares the plan set's ceiling and `local:` rule), its trade
 * sections are found by code (`specBookSections.ts`), and each section is read for
 * its facts (`specTrade.ts`) — behind the SAME switch as plan reading
 * (`PLAN_TEXT_READ`) and metered on the spec page allowance. Separate actions so
 * each stays short and a step can be retried alone. Nothing here is a price, and
 * nothing reaches the proposal until somebody presses Add.
 */

const NOT_YOURS = "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";
const LEASE_MS = 120_000;

function paths(jobId: string) {
  revalidatePath(`/jobs/${jobId}/specs`);
}

export async function recordSpecBook(jobId: string, fileUrl: string, fileName: string): Promise<ActionResultWith<{ bookId: string }>> {
  const fail = (m: string) => actionFail(m) as ActionResultWith<{ bookId: string }>;
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NOT_YOURS);
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId: context.company.id }, select: { id: true } });
  if (!job) return fail("That job is not on your account.");
  const problem = documentUrlProblem(fileUrl, "plan-takeoff", jobId, process.env);
  if (problem) return fail(problem);
  const book = await prisma.specBook.create({ data: { jobId, fileUrl, fileName: documentDisplayFileName(fileName) } });
  paths(jobId);
  return { ok: true, value: { bookId: book.id } };
}

export type FoundSummary = { trade: { id: string; number: string }[]; others: string[]; pagesWithText: number; pages: number };

/**
 * Find the book's trade sections and file each as a `BidSpecSection`. Once per book:
 * a book that already has its sections says so rather than filing them twice.
 */
export async function findSpecBookSections(bookId: string): Promise<ActionResultWith<FoundSummary>> {
  const fail = (m: string) => actionFail(m) as ActionResultWith<FoundSummary>;
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NOT_YOURS);
  const book = await prisma.specBook.findFirst({
    where: { id: bookId, job: { companyId: context.company.id } },
    select: { id: true, jobId: true, fileUrl: true, _count: { select: { sections: true } } },
  });
  if (!book) return fail("That spec book is no longer on this job.");
  if (book._count.sections > 0) return fail("This book's sections are already listed below.");

  const bytes = await readJobFileBytes(book.fileUrl, book.jobId, book.id);
  if (!bytes.ok) return fail(bytes.error);
  let pages: { page: number; lines: string[] }[];
  try {
    // ponytail: reads every page's text in one request; a 1,500-page book may need the plan-ingest runner's slices.
    pages = await pdfPageLines(bytes.bytes);
  } catch {
    return fail("That file couldn't be opened as a PDF.");
  }
  const scan = findSpecSections(pages);
  if (scan.pagesWithText === 0) {
    return fail("This book has no text to read — it looks scanned. Add its sections by hand below, one PDF each.");
  }
  const trade = scan.sections.filter((s) => s.trade);
  const created = await prisma.$transaction(
    trade.map((s) =>
      prisma.bidSpecSection.create({
        data: { jobId: book.jobId, specBookId: book.id, sectionNumber: s.number, title: s.title, pageFrom: s.pageFrom, pageTo: s.pageTo },
        select: { id: true, sectionNumber: true },
      }),
    ),
  );
  paths(book.jobId);
  return {
    ok: true,
    value: {
      trade: created.map((c) => ({ id: c.id, number: c.sectionNumber })),
      others: scan.sections.filter((s) => !s.trade).map((s) => s.number),
      pagesWithText: scan.pagesWithText,
      pages: pages.length,
    },
  };
}

export type SpecTradeResult = { items: number; dropped: number };

/** Read one section for its trade facts. Behind the plan-reading switch; charged by the section's pages. */
export async function readSpecTrade(bidSpecSectionId: string): Promise<ActionResultWith<SpecTradeResult>> {
  const fail = (m: string) => actionFail(m) as ActionResultWith<SpecTradeResult>;
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NOT_YOURS);
  const { company } = context;
  const section = await prisma.bidSpecSection.findFirst({
    where: { id: bidSpecSectionId, OR: [{ job: { companyId: company.id } }, { bidInvitation: { companyId: company.id } }] },
    select: {
      id: true,
      jobId: true,
      sectionNumber: true,
      title: true,
      fileUrl: true,
      pageFrom: true,
      pageTo: true,
      specBook: { select: { fileUrl: true, jobId: true } },
    },
  });
  if (!section) return fail("That spec section is no longer here.");

  const gate = await aiGate(company.id, "PLAN_TEXT_READ");
  if (!gate.ok) return fail(`${gate.error} Plan reading is the switch for spec reading too; read the section yourself.`);

  const claimed = await prisma.bidSpecSection.updateMany({
    where: { id: section.id, OR: [{ readInFlightAt: null }, { readInFlightAt: { lt: new Date(Date.now() - LEASE_MS) } }] },
    data: { readInFlightAt: new Date() },
  });
  if (claimed.count === 0) return fail("That section is being read right now. Give it a moment.");

  try {
    const pdf = await sectionPdf(section, company.id);
    if (!pdf.ok) return fail(pdf.error);
    const pages = await pdfPageLines(pdf.buffer, section.pageFrom ?? 1);
    if (pages.every((p) => p.lines.length === 0)) return fail("This section has no text to read — it looks scanned. Nothing was charged.");

    const spend = await claimSpecPages(company.id, gate.settings.specPagesPerMonth, pdf.mediaType, pdf.buffer);
    if (!spend.ok) return fail(spend.error);

    let read: SpecTradeRead;
    try {
      read = await extractSpecTrade({
        sectionNumber: section.sectionNumber,
        title: section.title,
        pages,
        model: gate.model,
        onUsage: (usage) =>
          recordAskUsage({
            companyId: company.id,
            userId: context.id,
            feature: "plan-text-read",
            model: gate.model,
            outcome: "proposal",
            jobId: section.jobId ?? undefined,
            promptVersion: SPEC_TRADE_PROMPT_VERSION,
            usage,
          }),
      });
    } catch (err) {
      if (isProviderOutage(err)) {
        // The provider refused it (out of credit, rate limit, 5xx): not charged, as plan reading (#1066).
        await releaseSpecPages(spend.claim, spend.charge.pages);
        return fail("The AI provider turned this read away (out of credit or busy), so nothing was read and nothing was charged. Try it again later.");
      }
      await markSpecFailure(spend.claim, spend.charge.pages);
      console.error("[spec-trade] the model call failed after the pages were claimed", err);
      return fail("That section couldn't be read. Its pages count as a failed read this month. Try it again, or read it yourself.");
    }

    // The spec eval's rule: a fact whose quote is not in the section's own words is dropped.
    const lines = pages.flatMap((p) => p.lines);
    const kept = <T extends { quote: string }>(items: T[]): T[] => items.filter((i) => quoteIsInDocument(i.quote, lines));
    const checked: SpecTradeRead = {
      products: kept(read.products),
      studs: kept(read.studs),
      boards: kept(read.boards),
      fireRatings: kept(read.fireRatings),
      ceilings: kept(read.ceilings),
      finishLevels: kept(read.finishLevels),
      priceDrivers: kept(read.priceDrivers),
      reason: read.reason,
    };
    const count = (r: SpecTradeRead) =>
      r.products.length + r.studs.length + r.boards.length + r.fireRatings.length + r.ceilings.length + r.finishLevels.length + r.priceDrivers.length;

    await prisma.specTradeReading.create({
      data: {
        bidSpecSectionId: section.id,
        facts: checked,
        readingReason: read.reason,
        pagesCharged: spend.charge.pages,
        model: gate.model,
        promptVersion: SPEC_TRADE_PROMPT_VERSION,
      },
    });
    if (section.jobId) paths(section.jobId);
    return { ok: true, value: { items: count(checked), dropped: count(read) - count(checked) } };
  } finally {
    await prisma.bidSpecSection.update({ where: { id: section.id }, data: { readInFlightAt: null } });
  }
}

/**
 * One price driver onto the job's proposal, as an inclusion or an alternate: a
 * snapshot clause like every other, never added twice.
 */
export async function addSpecDriverToProposal(
  readingId: string,
  index: number,
  kind: "INCLUSION" | "ALTERNATE",
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NOT_YOURS);
  const reading = await prisma.specTradeReading.findFirst({
    where: { id: readingId, bidSpecSection: { job: { companyId: context.company.id } } },
    select: { facts: true, bidSpecSection: { select: { jobId: true, sectionNumber: true } } },
  });
  const jobId = reading?.bidSpecSection.jobId;
  if (!reading || !jobId) return actionFail("That spec reading is no longer on this job.");
  const drivers = (reading.facts as { priceDrivers?: { label?: unknown }[] }).priceDrivers ?? [];
  const label = drivers[index]?.label;
  if (typeof label !== "string" || label.trim() === "") return actionFail("That item is no longer in the reading. Reload the page.");

  const text = `${label.trim()}, per specification section ${reading.bidSpecSection.sectionNumber}.`;
  const already = await prisma.jobProposalClause.count({ where: { jobId, companyId: context.company.id, text } });
  if (already > 0) return actionFail("That item is already on the proposal.");
  await prisma.jobProposalClause.create({ data: { companyId: context.company.id, jobId, kind, text } });

  revalidatePath(`/jobs/${jobId}/proposal`);
  paths(jobId);
  return actionOk;
}
