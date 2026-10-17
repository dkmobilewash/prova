"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { reviewSubcontractChunk, SUBCONTRACT_REVIEW_PROMPT_VERSION } from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { aiGate } from "@/lib/ai/settings";
import { recordAskUsage } from "@/lib/ask/usage";
import { claimContractPages, markContractFailure } from "@/lib/ask/contractSpend";
import { documentUrlProblem, isAllowedDocumentType, uploadMaxBytesFor } from "@/lib/document-uploads";
import { looksLikePdf } from "@/lib/pdf-bytes";
import { planChunks } from "@/lib/subcontract-review/chunks";
import { validateFindings } from "@/lib/subcontract-review/citations";
import { extractPdfPages, pageTextsFromJson, unreadPageNumbers, type PageTexts } from "@/lib/subcontract-review/pageText";
import {
  documentLabel,
  findingRows,
  nextChunk,
  parseExhibits,
  SOURCE_ROLE_LABEL,
  type SourceRole,
} from "@/lib/subcontract-review/run";
import { actionFail, actionOk, type ActionResult, type ActionResultWith } from "@/lib/actions/shared";

/**
 * AI SUBCONTRACT REVIEW — the server half. Design: docs/ai/SUBCONTRACT-REVIEW.md.
 *
 * Three verbs, and the split is the 60-second function limit:
 *
 *   start   — read every file into per-page text (code, no model), plan the
 *             chunks, write the review. No model call, nothing charged.
 *   advance — read ONE chunk: claim its pages, call the model, keep only the
 *             findings whose quote is found verbatim on a page code located,
 *             write them. The open page calls this in a loop, which is plan
 *             ingestion's shape (`advancePlanIngest`), on this feature's own
 *             rows.
 *   decide  — a person's call on one finding. Keyed on job + finding key, so
 *             it survives a re-run and carries to the next contract version.
 *
 * WHAT NONE OF THEM DOES: change the job, its retainage, its status, a
 * ContractDocument, a signature request or an alert. Everything written here
 * is either what a document said or what a person decided about it.
 *
 * Every action returns a sentence rather than throwing — production redacts a
 * thrown Server Action message (CLAUDE.md, Errors).
 */

const NOT_YOURS =
  "Contract documents aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** A chunk's lease. Longer than the function limit, so a request killed
 *  mid-chunk frees the review on its own rather than wedging it. */
const CHUNK_LEASE_MS = 90_000;

/** Stop waiting for the model before the platform stops us, so a slow chunk is
 *  recorded as failed with a sentence instead of dying silently (#793). */
const CHUNK_DEADLINE_MS = 50_000;

/** A review left unfinished this long is treated as abandoned, and a new one
 *  may start on the same version. */
const STALE_RUN_MS = 60 * 60 * 1000;

function reviewPath(jobId: string) {
  return `/jobs/${jobId}/subcontract-review`;
}

export type StartedReview = { reviewId: string; pagesToRead: number; unreadPages: number };

export async function startSubcontractReview(
  contractDocumentId: string,
  formData: FormData,
): Promise<ActionResultWith<StartedReview>> {
  const fail = (error: string) => ({ ok: false as const, error });
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return fail(NOT_YOURS);
  const { company, ...user } = context;

  const doc = await prisma.contractDocument.findFirst({
    where: { id: contractDocumentId, job: { companyId: company.id } },
    select: { id: true, jobId: true, fileUrl: true, fileName: true, versionNumber: true },
  });
  if (!doc) return fail("That contract version is no longer on this job.");

  const contractProblem = documentUrlProblem(doc.fileUrl, "contract-document", doc.jobId, process.env);
  if (contractProblem) return fail(contractProblem);

  const parsed = parseExhibits(formData.get("exhibits"));
  if (!parsed.ok) return fail(parsed.error);
  for (const exhibit of parsed.exhibits) {
    const problem = documentUrlProblem(exhibit.fileUrl, "subcontract-review-source", doc.jobId, process.env);
    if (problem) return fail(problem);
  }

  const gate = await aiGate(company.id, "SUBCONTRACT_REVIEW");
  if (!gate.ok) return fail(`${gate.error} You can still read the contract yourself.`);

  const running = await prisma.subcontractReview.findFirst({
    where: {
      contractDocumentId: doc.id,
      completedAt: null,
      failedAt: null,
      startedAt: { gt: new Date(Date.now() - STALE_RUN_MS) },
    },
    select: { id: true },
  });
  if (running) {
    return fail("A review of this version is already running. It continues while this page is open.");
  }

  const files: { role: SourceRole; fileUrl: string; fileName: string; purpose: "contract-document" | "subcontract-review-source" }[] = [
    { role: "AGREEMENT", fileUrl: doc.fileUrl, fileName: doc.fileName, purpose: "contract-document" },
    ...parsed.exhibits.map((exhibit) => ({ ...exhibit, purpose: "subcontract-review-source" as const })),
  ];

  const read: { role: SourceRole; fileUrl: string; fileName: string; pages: PageTexts }[] = [];
  for (const file of files) {
    const pages = await readFilePages(file.fileUrl, file.purpose);
    if (!pages.ok) return fail(`${SOURCE_ROLE_LABEL[file.role]} (${file.fileName}): ${pages.error}`);
    read.push({ role: file.role, fileUrl: file.fileUrl, fileName: file.fileName, pages: pages.pages });
  }

  const planned = read.map((source) => ({ ...source, chunks: planChunks(source.pages) }));
  const pagesToRead = planned.reduce((sum, source) => sum + new Set(source.chunks.flat()).size, 0);
  const unreadPages = planned.reduce((sum, source) => sum + unreadPageNumbers(source.pages).length, 0);
  if (pagesToRead === 0) {
    return fail(
      "None of these pages has text on it — they look scanned, so there is nothing this review can quote. " +
        "Nothing was charged. Ask the GC for a text PDF, or read the contract yourself.",
    );
  }

  const review = await prisma.subcontractReview.create({
    data: {
      jobId: doc.jobId,
      contractDocumentId: doc.id,
      model: gate.model,
      promptVersion: SUBCONTRACT_REVIEW_PROMPT_VERSION,
      startedByUserId: user.id,
      sources: {
        create: planned.map((source, index) => ({
          role: source.role,
          ordinal: index + 1,
          fileUrl: source.fileUrl,
          fileName: source.fileName,
          pageCount: source.pages.length,
          pageText: source.pages,
          unreadPages: unreadPageNumbers(source.pages),
          chunksTotal: source.chunks.length,
        })),
      },
    },
    select: { id: true },
  });

  revalidatePath(reviewPath(doc.jobId));
  return { ok: true, value: { reviewId: review.id, pagesToRead, unreadPages } };
}

export type AdvanceResult = {
  done: boolean;
  chunksDone: number;
  chunksTotal: number;
  findingsAdded: number;
  /** Set when the run stopped and needs a person — the sentence to show. */
  stopped: string | null;
};

export async function advanceSubcontractReview(reviewId: string): Promise<ActionResultWith<AdvanceResult>> {
  const fail = (error: string) => ({ ok: false as const, error });
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return fail(NOT_YOURS);
  const { company, ...user } = context;

  const review = await loadRun(reviewId, company.id);
  if (!review) return fail("That review is no longer on this job.");
  const progress = progressOf(review);
  if (review.completedAt) return { ok: true, value: { ...progress, done: true, findingsAdded: 0, stopped: null } };
  if (review.failedAt) {
    return { ok: true, value: { ...progress, done: false, findingsAdded: 0, stopped: review.failureReason } };
  }

  const gate = await aiGate(company.id, "SUBCONTRACT_REVIEW");
  if (!gate.ok) return fail(`${gate.error} What the review already found is kept.`);

  const claimed = await prisma.subcontractReview.updateMany({
    where: {
      id: review.id,
      completedAt: null,
      failedAt: null,
      OR: [{ chunkInFlightAt: null }, { chunkInFlightAt: { lt: new Date(Date.now() - CHUNK_LEASE_MS) } }],
    },
    data: { chunkInFlightAt: new Date() },
  });
  if (claimed.count === 0) {
    // Another tab holds this chunk. Not an error: report progress and let the
    // loop poll again.
    return { ok: true, value: { ...progress, done: false, findingsAdded: 0, stopped: null } };
  }

  try {
    const next = nextChunk(sourcesOf(review));
    if (!next) {
      await prisma.subcontractReview.update({ where: { id: review.id }, data: { completedAt: new Date() } });
      revalidatePath(reviewPath(review.jobId));
      return { ok: true, value: { ...progress, done: true, findingsAdded: 0, stopped: null } };
    }

    const spend = await claimContractPages(company.id, gate.settings.contractPagesPerMonth, next.chargedPages);
    if (!spend.ok) {
      await stop(review.id, spend.error);
      revalidatePath(reviewPath(review.jobId));
      return { ok: true, value: { ...progress, done: false, findingsAdded: 0, stopped: spend.error } };
    }

    const pageRange = `${next.pages[0]!.page}–${next.pages[next.pages.length - 1]!.page}`;
    let extraction;
    try {
      extraction = await withDeadline(
        reviewSubcontractChunk({
          documentLabel: documentLabel(next.source.role, next.source.fileName, review.contractDocument.versionNumber),
          roleLabel: SOURCE_ROLE_LABEL[next.source.role].toLowerCase(),
          pages: next.pages,
          model: gate.model,
          onUsage: (usage) =>
            recordAskUsage({
              companyId: company.id,
              userId: user.id,
              model: gate.model,
              usage,
              outcome: "proposal",
              feature: "subcontract-review",
              jobId: review.jobId,
              promptVersion: SUBCONTRACT_REVIEW_PROMPT_VERSION,
            }),
        }),
        CHUNK_DEADLINE_MS,
      );
    } catch (err) {
      await markContractFailure(spend.claim, spend.pages);
      // Metadata only — never the contract's text or the model's reply.
      console.error("[subcontract-review] a chunk failed after its pages were claimed", {
        reviewId: review.id,
        source: next.source.ordinal,
        chunk: next.index,
        error: err instanceof Error ? err.name : "unknown",
      });
      const sentence =
        `Pages ${pageRange} of the ${SOURCE_ROLE_LABEL[next.source.role].toLowerCase()} couldn't be read, so the ` +
        `review paused there. Those pages are recorded as a failed read on this month's allowance — the account ` +
        `owner can see them on Settings → Assistant. What was already found is kept; press Continue to try again.`;
      await stop(review.id, sentence);
      revalidatePath(reviewPath(review.jobId));
      return { ok: true, value: { ...progress, done: false, findingsAdded: 0, stopped: sentence } };
    }

    const { kept, dropped } = validateFindings(extraction.findings, next.pages);
    const rows = findingRows(kept);
    const created = await prisma.$transaction(async (tx) => {
      const inserted = await tx.subcontractFinding.createMany({
        data: rows.map((row) => ({
          ...row,
          terms: row.terms ?? undefined,
          reviewId: review.id,
          sourceId: next.source.id,
        })),
        // The overlap page means a clause can be found by two chunks; the
        // key collapses it onto the first.
        skipDuplicates: true,
      });
      await tx.subcontractReviewSource.update({
        where: { id: next.source.id },
        data: { chunksDone: { increment: 1 } },
      });
      await tx.subcontractReview.update({
        where: { id: review.id },
        data: {
          pagesCharged: { increment: spend.pages },
          findingsDropped: { increment: dropped.length },
        },
      });
      return inserted.count;
    });

    const after = progressOf({ ...review, sources: review.sources.map((s) => (s.id === next.source.id ? { ...s, chunksDone: s.chunksDone + 1 } : s)) });
    const done = after.chunksDone >= after.chunksTotal;
    if (done) await prisma.subcontractReview.update({ where: { id: review.id }, data: { completedAt: new Date() } });

    revalidatePath(reviewPath(review.jobId));
    return { ok: true, value: { ...after, done, findingsAdded: created, stopped: null } };
  } finally {
    try {
      await prisma.subcontractReview.updateMany({ where: { id: review.id }, data: { chunkInFlightAt: null } });
    } catch (err) {
      console.error("[subcontract-review] the chunk lease could not be released; it will expire", err);
    }
  }
}

/** Clear a stop so the open page can carry on from the next unread chunk. */
export async function continueSubcontractReview(reviewId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS);
  const review = await prisma.subcontractReview.findFirst({
    where: { id: reviewId, job: { companyId: context.company.id } },
    select: { id: true, jobId: true, completedAt: true },
  });
  if (!review) return actionFail("That review is no longer on this job.");
  if (review.completedAt) return actionOk;
  await prisma.subcontractReview.update({ where: { id: review.id }, data: { failedAt: null, failureReason: null } });
  revalidatePath(reviewPath(review.jobId));
  return actionOk;
}

const DECISIONS = ["ACCEPTED", "DISMISSED", "NEGOTIATED"] as const;
const SEVERITIES = ["HIGH", "MEDIUM", "LOW"] as const;
/** Long enough for a real note; short enough that a paste of the whole contract is refused. */
const MAX_NOTE = 2000;

/**
 * A person's call on one finding: accept, dismiss or mark it negotiating, with
 * an optional note and optional edits to the severity, the explanation and the
 * position. The finding itself is never changed — the edit sits beside it.
 */
export async function decideSubcontractFinding(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS);
  const { company, ...user } = context;

  const key = String(formData.get("key") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!(DECISIONS as readonly string[]).includes(decision)) return actionFail("Choose accept, dismiss or negotiating.");

  // The key must name a finding on THIS job — never a free-floating string.
  const finding = await prisma.subcontractFinding.findFirst({
    where: { key, review: { jobId, job: { companyId: company.id } } },
    orderBy: { createdAt: "desc" },
    select: { id: true, severity: true, explanation: true, suggestedPosition: true },
  });
  if (!finding) return actionFail("That finding is no longer on this job's review.");

  const text = (name: string) => {
    const value = String(formData.get(name) ?? "").trim();
    return value === "" ? null : value;
  };
  const note = text("note");
  // An "edit" that repeats what the review said is not an edit: store null, so
  // the card does not claim the person rewrote something they left alone.
  const editedExplanation = differs(text("editedExplanation"), finding.explanation);
  const editedPosition = differs(text("editedPosition"), finding.suggestedPosition);
  for (const [label, value] of [["note", note], ["explanation", editedExplanation], ["position", editedPosition]] as const) {
    if (value && value.length > MAX_NOTE) return actionFail(`Keep the ${label} under ${MAX_NOTE} characters.`);
  }
  const severityRaw = text("editedSeverity");
  const editedSeverity =
    severityRaw && severityRaw !== finding.severity && (SEVERITIES as readonly string[]).includes(severityRaw)
      ? (severityRaw as (typeof SEVERITIES)[number])
      : null;

  const data = {
    decision: decision as (typeof DECISIONS)[number],
    note,
    editedSeverity,
    editedExplanation,
    editedPosition,
    decidedByUserId: user.id,
    decidedAt: new Date(),
  };
  await prisma.subcontractFindingDecision.upsert({
    where: { jobId_key: { jobId, key } },
    create: { jobId, key, ...data },
    update: data,
  });

  revalidatePath(reviewPath(jobId));
  return actionOk;
}

/** Undo a decision: the finding goes back to "not reviewed yet". */
export async function clearSubcontractFindingDecision(jobId: string, key: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(NOT_YOURS);
  await prisma.subcontractFindingDecision.deleteMany({ where: { jobId, key, job: { companyId: context.company.id } } });
  revalidatePath(reviewPath(jobId));
  return actionOk;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function differs(value: string | null, original: string): string | null {
  return value !== null && value !== original.trim() ? value : null;
}

async function loadRun(reviewId: string, companyId: string) {
  return prisma.subcontractReview.findFirst({
    where: { id: reviewId, job: { companyId } },
    select: {
      id: true,
      jobId: true,
      completedAt: true,
      failedAt: true,
      failureReason: true,
      contractDocument: { select: { versionNumber: true } },
      sources: {
        select: { id: true, ordinal: true, role: true, fileName: true, pageText: true, chunksDone: true, chunksTotal: true },
      },
    },
  });
}

type LoadedRun = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

function sourcesOf(review: LoadedRun) {
  return review.sources.map((source) => ({
    id: source.id,
    ordinal: source.ordinal,
    role: source.role as SourceRole,
    fileName: source.fileName,
    pageTexts: pageTextsFromJson(source.pageText),
    chunksDone: source.chunksDone,
    chunksTotal: source.chunksTotal,
  }));
}

function progressOf(review: { sources: readonly { chunksDone: number; chunksTotal: number }[] }) {
  return {
    chunksDone: review.sources.reduce((sum, source) => sum + Math.min(source.chunksDone, source.chunksTotal), 0),
    chunksTotal: review.sources.reduce((sum, source) => sum + source.chunksTotal, 0),
  };
}

async function stop(reviewId: string, reason: string) {
  await prisma.subcontractReview.update({ where: { id: reviewId }, data: { failedAt: new Date(), failureReason: reason } });
}

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("deadline")), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readFilePages(
  fileUrl: string,
  purpose: "contract-document" | "subcontract-review-source",
): Promise<{ ok: true; pages: PageTexts } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(fileUrl);
  } catch {
    return { ok: false, error: "the file couldn't be fetched from storage. Try again in a moment." };
  }
  if (!response.ok) return { ok: false, error: "the file couldn't be fetched from storage. Try again in a moment." };

  const served = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!isAllowedDocumentType(served)) return { ok: false, error: "the file isn't a PDF or an image, so it can't be read." };
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > uploadMaxBytesFor(purpose)) {
    return { ok: false, error: "the file is empty or too big to read." };
  }
  // A photo of a page has no text layer by definition: one page, unread.
  if (served !== "application/pdf" || !looksLikePdf(buffer)) return { ok: true, pages: [null] };
  try {
    return { ok: true, pages: await extractPdfPages(buffer) };
  } catch (err) {
    console.error("[subcontract-review] a PDF could not be opened", { error: err instanceof Error ? err.name : "unknown" });
    return { ok: false, error: "the PDF couldn't be opened — it may be damaged or password-protected." };
  }
}
