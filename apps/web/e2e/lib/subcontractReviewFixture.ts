import { prisma } from "@prova/db";
import { E2E_TAG } from "./tag";

/**
 * A FINISHED SUBCONTRACT REVIEW, SEEDED, FOR `specs/subcontract-review.spec.ts`.
 *
 * Seeded rather than run, and the reason is a property of CI rather than a
 * shortcut: the e2e job forces `ANTHROPIC_API_KEY` empty, so no model call can
 * succeed there and no review could ever finish. What the browser CAN prove is
 * everything a person does once one has — the findings render with their quote
 * and page, each can be accepted, negotiated, annotated, dismissed and undone,
 * and every decision survives a reload. The model path is proved elsewhere: the
 * citation gate and the run loop by `subcontractReview.dbtest.ts`, the reading
 * by the paid eval.
 *
 * The keys are written out in `findingKey()`'s shape (`CATEGORY:` + 16 hex)
 * rather than computed, because this file deliberately imports nothing from the
 * app — the same rule `salesFixture.ts` keeps.
 *
 * REPLACED EVERY RUN: the spec changes decisions, and a scratch database that
 * survived a previous run must hand the spec the same opening state.
 */

export const SUBCONTRACT_REVIEW_JOB = `${E2E_TAG} Subcontract Review Job`;

export const SEEDED_FINDINGS = [
  {
    key: "PAYMENT:0e2e0000000000a1",
    category: "PAYMENT",
    subtype: "PAY_IF_PAID",
    severity: "HIGH",
    title: "Pay-if-paid",
    quote:
      "Receipt of payment by Contractor from Owner for the Work is a condition precedent to any obligation of Contractor to pay Subcontractor.",
    pageStart: 2,
    pageEnd: 2,
    sectionRef: "3.2",
    explanation: "You are paid only if the owner pays the GC, even when your work is done and accepted.",
    suggestedPosition: "Ask for pay-when-paid with an outside date of 60 days.",
    questionForGc: "Will you accept pay-when-paid with a 60-day outside date?",
  },
  {
    key: "LIQUIDATED_DAMAGES:0e2e0000000000a2",
    category: "LIQUIDATED_DAMAGES",
    subtype: "LD_RATE",
    severity: "HIGH",
    title: "$1,500/day liquidated damages",
    quote: "Subcontractor shall pay liquidated damages of one thousand five hundred dollars ($1,500.00) per calendar day.",
    pageStart: 3,
    pageEnd: 3,
    sectionRef: "5.1",
    explanation: "Every day the job runs late can cost you $1,500, whoever caused the delay.",
    suggestedPosition: "Limit LDs to delay you caused, capped at a share of your subcontract.",
    questionForGc: null,
  },
  {
    key: "NOTICE:0e2e0000000000a3",
    category: "NOTICE",
    subtype: "DELAY_NOTICE",
    severity: "MEDIUM",
    title: "48-hour delay notice",
    quote: "Subcontractor shall give Contractor written notice of any delay within forty-eight (48) hours.",
    pageStart: 4,
    pageEnd: 4,
    sectionRef: "7.1",
    explanation: "Miss the 48-hour window and you lose the right to more time or money for that delay.",
    suggestedPosition: "Ask for 7 days, and for notice by email to the PM to count.",
    questionForGc: null,
  },
] as const;

export async function seedSubcontractReview(persona: { id: string; email: string }): Promise<void> {
  const user = await prisma.user.upsert({
    where: { clerkId: persona.id },
    update: {},
    create: {
      clerkId: persona.id,
      email: persona.email,
      name: "E2E SUBCONTRACT REVIEW",
      role: "OWNER",
      company: { create: { name: `${E2E_TAG} Subcontract Review Co`, businessScopeAskedAt: new Date("2026-01-01T00:00:00Z") } },
    },
    select: { id: true, companyId: true },
  });
  await prisma.company.updateMany({
    where: { id: user.companyId, businessScopeAskedAt: null },
    data: { businessScopeAskedAt: new Date("2026-01-01T00:00:00Z") },
  });

  let job = await prisma.job.findFirst({ where: { companyId: user.companyId, name: SUBCONTRACT_REVIEW_JOB }, select: { id: true } });
  if (!job) {
    const contact = await prisma.contact.create({
      data: { companyId: user.companyId, name: `${E2E_TAG} Review GC`, status: "ACTIVE" },
    });
    job = await prisma.job.create({
      data: { companyId: user.companyId, contactId: contact.id, name: SUBCONTRACT_REVIEW_JOB, status: "ESTIMATE" },
      select: { id: true },
    });
  }

  // Replace, never reuse: the spec mutates decisions.
  await prisma.subcontractFindingDecision.deleteMany({ where: { jobId: job.id } });
  await prisma.subcontractReview.deleteMany({ where: { jobId: job.id } });
  await prisma.contractDocument.deleteMany({ where: { jobId: job.id } });
  await prisma.contractDocumentVersionCounter.deleteMany({ where: { jobId: job.id } });

  // Version and counter in ONE transaction, the way every writer of a
  // ContractDocument issues its number (`counterCensus.test.ts`).
  const doc = await prisma.$transaction(async (tx) => {
    await tx.contractDocumentVersionCounter.upsert({
      where: { jobId: job.id },
      create: { jobId: job.id, lastNumber: 1 },
      update: { lastNumber: 1 },
    });
    return tx.contractDocument.create({
      data: {
        jobId: job.id,
        versionNumber: 1,
        // Not a real blob: nothing in the spec opens it, and the review action
        // would refuse it (wrong store), which the spec asserts.
        fileUrl: "https://example.com/zz-e2e-subcontract.pdf",
        fileName: "ZZ-E2E Subcontract.pdf",
      },
    });
  });

  const pageText = [1, 2, 3, 4].map((page) => [`ZZ SYNTHETIC page ${page}`]);
  await prisma.subcontractReview.create({
    data: {
      jobId: job.id,
      contractDocumentId: doc.id,
      model: "seeded",
      promptVersion: "seeded",
      startedByUserId: user.id,
      completedAt: new Date(),
      pagesCharged: 4,
      findingsDropped: 1,
      sources: {
        create: [
          {
            role: "AGREEMENT",
            ordinal: 1,
            fileUrl: doc.fileUrl,
            fileName: doc.fileName,
            pageCount: 5,
            pageText: [...pageText, null],
            unreadPages: [5],
            chunksTotal: 1,
            chunksDone: 1,
          },
        ],
      },
    },
  });
  const review = await prisma.subcontractReview.findFirstOrThrow({
    where: { jobId: job.id },
    select: { id: true, sources: { select: { id: true } } },
  });
  await prisma.subcontractFinding.createMany({
    data: SEEDED_FINDINGS.map((finding) => ({ ...finding, reviewId: review.id, sourceId: review.sources[0]!.id })),
  });
}
