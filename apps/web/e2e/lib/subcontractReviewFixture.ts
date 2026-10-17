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
    terms: { noticeHours: 48, noticeRecipient: "the Project Manager", noticeForm: "in writing" },
  },
  // Phase 2: the figures the scope check compares, each verified to be in its quote.
  {
    key: "RETAINAGE:0e2e0000000000a4",
    category: "RETAINAGE",
    subtype: "RETAINAGE_RATE",
    severity: "MEDIUM",
    title: "10% retainage to final completion",
    quote: "Contractor shall retain ten percent (10%) of each progress payment.",
    pageStart: 2,
    pageEnd: 2,
    sectionRef: "3.3",
    explanation: "A tenth of every payment is held until the whole project is finished.",
    suggestedPosition: "Ask for 5%, released at substantial completion of your work.",
    questionForGc: null,
    terms: { retainagePercent: 10 },
  },
  {
    key: "SCOPE:0e2e0000000000a5",
    category: "SCOPE",
    subtype: "CONTRACT_SUM",
    severity: "LOW",
    title: "Subcontract sum",
    quote: "the Subcontract Sum of Four Hundred Twelve Thousand Dollars ($412,000.00)",
    pageStart: 1,
    pageEnd: 1,
    sectionRef: "2.1",
    explanation: "The price you are agreeing to.",
    suggestedPosition: "Confirm it matches your bid and any accepted alternates.",
    questionForGc: null,
    terms: { contractSum: 412000 },
  },
  {
    key: "SCOPE:0e2e0000000000a6",
    category: "SCOPE",
    subtype: "ADDENDA_LIST",
    severity: "LOW",
    title: "Addenda incorporated",
    quote: "The Contract Documents include Addenda Nos. 1, 2 and 3.",
    pageStart: 1,
    pageEnd: 1,
    sectionRef: "1.3",
    explanation: "These addenda are part of what you are agreeing to build.",
    suggestedPosition: "Confirm you priced every addendum listed.",
    questionForGc: null,
  },
] as const;

/** The two proposal clauses the scope check compares against. */
export const SEEDED_CLAUSES = {
  fireCaulking: "Firestopping and fire caulking are excluded.",
  cleaning: "Final cleaning is excluded.",
} as const;

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
  const jobRow = await prisma.job.update({ where: { id: job.id }, data: { retainagePercent: 5 }, select: { contactId: true } });

  // OUR side: the won bid ($400,000 + an accepted $12,000 alternate = the
  // contract's $412,000), two addenda (one never acknowledged), two exclusions.
  await prisma.bidInvitation.deleteMany({ where: { wonJobId: job.id } });
  await prisma.jobProposalClause.deleteMany({ where: { jobId: job.id } });
  await prisma.bidInvitation.create({
    data: {
      companyId: user.companyId,
      contactId: jobRow.contactId,
      projectName: `${E2E_TAG} Review Project`,
      status: "WON",
      bidAmount: 400000,
      wonJobId: job.id,
      lines: { create: [{ companyId: user.companyId, kind: "ALTERNATE", label: "Alt 1 - Level 5 lobby", amount: 12000, accepted: true }] },
      addenda: {
        create: [
          { companyId: user.companyId, reference: "Addendum 1", acknowledgedOn: new Date("2026-09-01T00:00:00Z") },
          { companyId: user.companyId, reference: "Addendum 2" },
        ],
      },
    },
  });
  const [fireClause] = await prisma.$transaction([
    prisma.jobProposalClause.create({ data: { companyId: user.companyId, jobId: job.id, kind: "EXCLUSION", text: SEEDED_CLAUSES.fireCaulking, sortOrder: 1 } }),
    prisma.jobProposalClause.create({ data: { companyId: user.companyId, jobId: job.id, kind: "EXCLUSION", text: SEEDED_CLAUSES.cleaning, sortOrder: 2 } }),
  ]);

  // Replace, never reuse: the spec mutates decisions.
  await prisma.subcontractFindingDecision.deleteMany({ where: { jobId: job.id } });
  await prisma.subcontractObligation.deleteMany({ where: { jobId: job.id } });
  await prisma.subcontractInsuranceRequirement.deleteMany({ where: { jobId: job.id } });
  await prisma.subcontractRider.deleteMany({ where: { jobId: job.id } });
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
      // A scope-checked generation, so the page derives "not carried" gaps.
      promptVersion: "subcontract-review.2",
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
  await prisma.subcontractScopeCheck.create({
    data: {
      reviewId: review.id,
      sourceId: review.sources[0]!.id,
      key: `CONTRADICTS_OUR_CLAUSE:${fireClause.id}:0e2e0000000000b1`,
      relation: "CONTRADICTS_OUR_CLAUSE",
      clauseId: fireClause.id,
      clauseKind: "EXCLUSION",
      clauseText: SEEDED_CLAUSES.fireCaulking,
      quote: "Subcontractor shall furnish and install firestopping and fire caulking at all rated wall and ceiling assemblies.",
      pageStart: 1,
      pageEnd: 1,
      explanation: "The contract puts firestopping on you, which your proposal excluded.",
    },
  });
}
