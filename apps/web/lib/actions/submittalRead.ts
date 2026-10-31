"use server";

import { revalidatePath } from "next/cache";
import { extractSubmittalRequirements, SUBMITTAL_READ_PROMPT_VERSION } from "@prova/integrations";
import { prisma } from "@prova/db";
import { aiGate } from "@/lib/ai/settings";
import { recordAskUsage } from "@/lib/ask/usage";
import { claimSpecPages, markSpecFailure } from "@/lib/ask/specSpend";
import { requireCompanyContext } from "@/lib/auth";
import { documentUrlProblem } from "@/lib/document-uploads";
import { can } from "@/lib/permissions";
import { readStoredSpecSection } from "@/lib/specs/read-stored-section";
import { newRequirements } from "@/lib/submittal-proposals";
import { actionFail, type ActionResultWith } from "./shared";

const LEASE_MS = 120_000;

const NOT_YOURS =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";

type Result = { draftCount: number; note: string };

/**
 * Reads one of a job's spec sections for what it requires to be submitted, and
 * writes draft rows. Same gate, claim, page allowance and failure rule as
 * `readSpecSection`; a read charges pages, so it answers to the same capability
 * as the upload. It reaches a section through the job: its own, or the winning
 * bid's. A re-read replaces undecided drafts and leaves decided ones alone.
 */
export async function readSubmittalRequirements(jobId: string, bidSpecSectionId: string): Promise<ActionResultWith<Result>> {
  const fail = (message: string) => actionFail(message) as ActionResultWith<Result>;
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return fail(NOT_YOURS);
  const { company, ...user } = context;

  const section = await prisma.bidSpecSection.findFirst({
    where: {
      id: bidSpecSectionId,
      OR: [{ job: { id: jobId, companyId: company.id } }, { bidInvitation: { wonJobId: jobId, companyId: company.id } }],
    },
    select: { id: true, fileUrl: true, fileName: true, sectionNumber: true },
  });
  if (!section) return fail("That spec section is no longer on this job.");
  if (!section.fileUrl) return fail("There's no document on that section yet. Attach the PDF first.");

  const problem = documentUrlProblem(section.fileUrl, "bid-spec-section", company.id, process.env);
  if (problem) return fail(problem);

  const gate = await aiGate(company.id, "SUBMITTAL_READ");
  if (!gate.ok) return fail(`${gate.error} You can still add submittals by hand.`);

  const claimed = await prisma.bidSpecSection.updateMany({
    where: {
      id: section.id,
      OR: [{ readInFlightAt: null }, { readInFlightAt: { lt: new Date(Date.now() - LEASE_MS) } }],
    },
    data: { readInFlightAt: new Date() },
  });
  if (claimed.count === 0) return fail("That section is being read right now. Give it a moment.");

  try {
    const read = await readStoredSpecSection(section.fileUrl);
    if (!read.ok) return fail(read.error);

    const spend = await claimSpecPages(company.id, gate.settings.specPagesPerMonth, read.mediaType, read.buffer);
    if (!spend.ok) return fail(spend.error);

    let extraction;
    try {
      extraction = await extractSubmittalRequirements({
        fileBase64: read.buffer.toString("base64"),
        mediaType: read.mediaType,
        fileName: section.fileName ?? `${section.sectionNumber}.pdf`,
        model: gate.model,
        onUsage: (usage) =>
          recordAskUsage({
            companyId: company.id,
            userId: user.id,
            model: gate.model,
            usage,
            outcome: "proposal",
            feature: "submittal-read",
            promptVersion: SUBMITTAL_READ_PROMPT_VERSION,
          }),
      });
    } catch (err) {
      // Marked, not released, as the cost reader does: the provider bills a
      // request that died halfway.
      await markSpecFailure(spend.claim, spend.charge.pages);
      console.error("[submittal-read] the model call failed after the pages were claimed", err);
      return fail(
        "That section couldn't be read. Its pages are recorded as a failed read on this month's allowance. Nothing was saved.",
      );
    }

    const decided = await prisma.submittalProposal.findMany({
      where: { jobId, sectionNumber: section.sectionNumber, status: { not: "PROPOSED" } },
      select: { requirement: true, quote: true },
    });
    const fresh = newRequirements(extraction.requirements, decided);

    await prisma.$transaction(async (tx) => {
      await tx.submittalProposal.deleteMany({
        where: { jobId, status: "PROPOSED", reading: { bidSpecSectionId: section.id } },
      });
      await tx.submittalSpecReading.create({
        data: {
          bidSpecSectionId: section.id,
          jobId,
          readingReason: extraction.readingReason,
          pagesCharged: spend.charge.pages,
          model: gate.model,
          promptVersion: SUBMITTAL_READ_PROMPT_VERSION,
          startedByUserId: user.id,
          proposals: {
            create: fresh.map((row) => ({
              jobId,
              sectionNumber: section.sectionNumber,
              kind: row.kind,
              requirement: row.requirement,
              confidence: row.confidence,
              quote: row.quote,
              sourcePageLabel: row.sourcePageLabel,
            })),
          },
        },
      });
    });

    revalidatePath(`/jobs/${jobId}/specs`);
    revalidatePath("/submittals");
    return { ok: true, value: { draftCount: fresh.length, note: spend.note } };
  } finally {
    try {
      await prisma.bidSpecSection.updateMany({ where: { id: section.id }, data: { readInFlightAt: null } });
    } catch (err) {
      console.error("[submittal-read] the in-flight claim could not be released; the lease will expire it", err);
    }
  }
}
