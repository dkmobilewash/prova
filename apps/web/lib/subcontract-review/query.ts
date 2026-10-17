import { prisma } from "@prova/db";
import { applyDecisions, diffFindings, type DecisionView, type DiffEntry, type FindingView, type ReviewedFinding } from "./findings";
import { SOURCE_ROLE_LABEL, type SourceRole } from "./run";
import { describePageRuns } from "./pageText";
import { scopeReport, type ScopeReport } from "./scopeCheck";
import { buildSummary, type ReviewSummary } from "./summary";
import { proposeObligation, type ObligationProposal } from "./obligations";
import { proposeInsurance, type InsuranceProposal } from "./insurance";

/**
 * Everything the review page shows for one contract version, read once.
 * Reads only. Derived state — open/decided, what changed since the previous
 * version, the counts — is computed here on every read and never stored.
 */

export type ReviewSourceView = {
  id: string;
  role: SourceRole;
  roleLabel: string;
  fileName: string;
  fileUrl: string;
  pageCount: number;
  unreadPages: number[];
  chunksDone: number;
  chunksTotal: number;
};

export type ReviewView = {
  id: string;
  state: "RUNNING" | "STOPPED" | "COMPLETE";
  failureReason: string | null;
  startedAt: Date;
  completedAt: Date | null;
  pagesCharged: number;
  findingsDropped: number;
  model: string;
  chunksDone: number;
  chunksTotal: number;
  sources: ReviewSourceView[];
  findings: ReviewedFinding[];
  /** Scope checks, as stored — the report below is what the page reads. */
  scopeChecks: ScopeCheckView[];
  /** Run with a prompt that compared against our side (.2 or later). */
  scopeChecked: boolean;
};

export type ScopeCheckView = {
  key: string;
  relation: "CONTRADICTS_OUR_CLAUSE" | "CARRIES_OUR_CLAUSE" | "NOT_IN_OUR_PRICED_SCOPE";
  clauseId: string | null;
  clauseKind: string | null;
  clauseText: string | null;
  quote: string;
  pageStart: number;
  pageEnd: number;
  explanation: string;
  sourceLabel: string;
};

export type VersionOption = { id: string; versionNumber: number; fileName: string; executed: boolean; isRider: boolean };

export type RiderView = {
  id: string;
  status: "DRAFT" | "ATTACHED";
  title: string;
  body: string;
  attachedVersionNumber: number | null;
  attachedAt: Date | null;
  createdAt: Date;
};

export type ObligationView = {
  id: string;
  kind: "NOTICE_WINDOW" | "MONTHLY_DAY" | "DATED";
  label: string;
  windowHours: number | null;
  windowDays: number | null;
  dayOfMonth: number | null;
  dueOn: string | null;
  recipient: string | null;
  form: string | null;
  quote: string | null;
  pageStart: number | null;
};

export type InsuranceView = {
  id: string;
  coverage: string;
  coverageLabel: string | null;
  limitPerOccurrence: number | null;
  limitAggregate: number | null;
  endorsements: string[];
  completedOpsYears: number | null;
  notes: string | null;
  quote: string | null;
  pageStart: number | null;
};

/** What Phase 3 shows: the person's own records, and what the findings propose. */
export type FollowThrough = {
  riders: RiderView[];
  obligations: ObligationView[];
  insurance: InsuranceView[];
  proposedObligations: { findingKey: string; quote: string; pageStart: number; proposal: ObligationProposal }[];
  proposedInsurance: { findingKey: string; quote: string; pageStart: number; proposal: InsuranceProposal }[];
};

export type ReviewPageData = {
  job: { id: string; name: string };
  versions: VersionOption[];
  selected: VersionOption | null;
  review: ReviewView | null;
  /** The newest COMPLETED review of an EARLIER version, and the diff against it. */
  previous: { versionNumber: number; reviewId: string; diff: DiffEntry<ReviewedFinding>[] } | null;
  /** Section B — null when there is no review yet. */
  scope: ScopeReport | null;
  /** Section C — null when there is no review yet. */
  summary: ReviewSummary | null;
  /** Decisions on scope gaps, by key (gaps are not findings). */
  decisions: DecisionView[];
  followThrough: FollowThrough;
};

const REVIEW_SELECT = {
  id: true,
  startedAt: true,
  completedAt: true,
  failedAt: true,
  failureReason: true,
  pagesCharged: true,
  findingsDropped: true,
  model: true,
  promptVersion: true,
  contractDocument: { select: { versionNumber: true } },
  scopeChecks: {
    orderBy: [{ pageStart: "asc" as const }, { createdAt: "asc" as const }],
    select: {
      key: true,
      sourceId: true,
      relation: true,
      clauseId: true,
      clauseKind: true,
      clauseText: true,
      quote: true,
      pageStart: true,
      pageEnd: true,
      explanation: true,
    },
  },
  sources: {
    orderBy: { ordinal: "asc" as const },
    select: {
      id: true,
      role: true,
      fileName: true,
      fileUrl: true,
      pageCount: true,
      unreadPages: true,
      chunksDone: true,
      chunksTotal: true,
    },
  },
  findings: {
    orderBy: [{ pageStart: "asc" as const }, { createdAt: "asc" as const }],
    select: {
      id: true,
      key: true,
      sourceId: true,
      category: true,
      subtype: true,
      severity: true,
      title: true,
      quote: true,
      pageStart: true,
      pageEnd: true,
      sectionRef: true,
      explanation: true,
      suggestedPosition: true,
      questionForGc: true,
      terms: true,
    },
  },
};

type ReviewRow = NonNullable<Awaited<ReturnType<typeof loadReviewRow>>>;

function loadReviewRow(where: Parameters<typeof prisma.subcontractReview.findFirst>[0]) {
  return prisma.subcontractReview.findFirst({ ...where, select: REVIEW_SELECT });
}

function toView(row: ReviewRow, decisions: readonly DecisionView[]): ReviewView {
  const sources: ReviewSourceView[] = row.sources.map((source) => ({
    ...source,
    role: source.role as SourceRole,
    roleLabel: SOURCE_ROLE_LABEL[source.role as SourceRole],
  }));
  const labelFor = new Map(sources.map((source) => [source.id, source.roleLabel]));
  const findings: FindingView[] = row.findings.map((finding) => ({
    ...finding,
    terms: (finding.terms as FindingView["terms"]) ?? null,
    sourceLabel: labelFor.get(finding.sourceId) ?? "Contract",
  }));
  return {
    id: row.id,
    state: row.completedAt ? "COMPLETE" : row.failedAt ? "STOPPED" : "RUNNING",
    failureReason: row.failureReason,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    pagesCharged: row.pagesCharged,
    findingsDropped: row.findingsDropped,
    model: row.model,
    chunksDone: sources.reduce((sum, source) => sum + Math.min(source.chunksDone, source.chunksTotal), 0),
    chunksTotal: sources.reduce((sum, source) => sum + source.chunksTotal, 0),
    sources,
    findings: applyDecisions(findings, decisions),
    scopeChecks: row.scopeChecks.map((check) => ({ ...check, sourceLabel: labelFor.get(check.sourceId) ?? "Contract" })),
    scopeChecked: promptGeneration(row.promptVersion) >= 2,
  };
}

/** "subcontract-review.2" → 2; anything unparseable (a seeded row) → 0. */
export function promptGeneration(promptVersion: string): number {
  const match = /^subcontract-review\.(\d+)$/.exec(promptVersion);
  return match ? Number(match[1]) : 0;
}

export async function loadReviewPage(
  jobId: string,
  companyId: string,
  versionId: string | undefined,
  /** A specific review (the printed summary) rather than the version's newest. */
  reviewId?: string,
): Promise<ReviewPageData | null> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId },
    select: {
      id: true,
      name: true,
      contractDocuments: {
        orderBy: { versionNumber: "desc" },
        select: {
          id: true,
          versionNumber: true,
          fileName: true,
          executedSignedDate: true,
          subcontractRider: { select: { id: true } },
        },
      },
    },
  });
  if (!job) return null;

  const versions: VersionOption[] = job.contractDocuments.map((doc) => ({
    id: doc.id,
    versionNumber: doc.versionNumber,
    fileName: doc.fileName,
    executed: doc.executedSignedDate !== null,
    isRider: doc.subcontractRider !== null,
  }));
  // Default to the newest version that is not one of OUR riders: attaching a
  // rider makes it the newest version, and the review a person came back for
  // is of the GC's contract, not of our own rider.
  const selected =
    versions.find((version) => version.id === versionId) ?? versions.find((version) => !version.isRider) ?? versions[0] ?? null;
  if (!selected) {
    return {
      job: { id: job.id, name: job.name },
      versions,
      selected: null,
      review: null,
      previous: null,
      scope: null,
      summary: null,
      decisions: [],
      followThrough: await loadFollowThrough(job.id, null),
    };
  }

  const [row, decisionRows] = await Promise.all([
    loadReviewRow({
      where: { contractDocumentId: selected.id, jobId: job.id, ...(reviewId ? { id: reviewId } : {}) },
      orderBy: { startedAt: "desc" },
    }),
    prisma.subcontractFindingDecision.findMany({
      where: { jobId: job.id },
      select: { key: true, decision: true, note: true, editedSeverity: true, editedExplanation: true, editedPosition: true },
    }),
  ]);
  const decisions: DecisionView[] = decisionRows;
  const review = row ? toView(row, decisions) : null;

  let previous: ReviewPageData["previous"] = null;
  if (review) {
    const earlier = versions.filter((version) => version.versionNumber < selected.versionNumber).map((version) => version.id);
    if (earlier.length > 0) {
      const previousRow = await loadReviewRow({
        where: { jobId: job.id, contractDocumentId: { in: earlier }, completedAt: { not: null } },
        orderBy: [{ contractDocument: { versionNumber: "desc" } }, { startedAt: "desc" }],
      });
      if (previousRow) {
        previous = {
          versionNumber: previousRow.contractDocument.versionNumber,
          reviewId: previousRow.id,
          diff: diffFindings(toView(previousRow, decisions).findings, review.findings),
        };
      }
    }
  }

  let scope: ScopeReport | null = null;
  let summary: ReviewSummary | null = null;
  if (review) {
    scope = scopeReport({
      ...(await loadBidSide(job.id, companyId)),
      findings: review.findings,
      scopeChecks: review.scopeChecks,
      reviewComplete: review.state === "COMPLETE",
      scopeChecked: review.scopeChecked,
      pagesRead: review.pagesCharged,
      unreadPages: review.sources.reduce((sum, source) => sum + source.unreadPages.length, 0),
    });
    const unreadSources = review.sources.filter((source) => source.unreadPages.length > 0);
    summary = buildSummary(
      review.findings,
      scope,
      unreadSources.length > 0
        ? unreadSources.map((source) => `${source.roleLabel}, pages ${describePageRuns(source.unreadPages)}`).join("; ")
        : null,
    );
  }

  return {
    job: { id: job.id, name: job.name },
    versions,
    selected,
    review,
    previous,
    scope,
    summary,
    decisions,
    followThrough: await loadFollowThrough(job.id, review),
  };
}

/** Phase 3's rows, plus what the current review's findings propose that the
 *  person has not already confirmed (or dismissed). */
async function loadFollowThrough(jobId: string, review: ReviewView | null): Promise<FollowThrough> {
  const [riders, obligations, insurance] = await Promise.all([
    prisma.subcontractRider.findMany({
      where: { jobId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        title: true,
        body: true,
        attachedAt: true,
        createdAt: true,
        attachedContractDocument: { select: { versionNumber: true } },
      },
    }),
    prisma.subcontractObligation.findMany({ where: { jobId }, orderBy: { confirmedAt: "asc" } }),
    prisma.subcontractInsuranceRequirement.findMany({ where: { jobId }, orderBy: { confirmedAt: "asc" } }),
  ]);
  const confirmedKeys = new Set([...obligations, ...insurance].map((row) => row.findingKey).filter(Boolean));
  const live = (review?.findings ?? []).filter((f) => f.status !== "DISMISSED" && !confirmedKeys.has(f.key));
  return {
    riders: riders.map((rider) => ({
      id: rider.id,
      status: rider.status,
      title: rider.title,
      body: rider.body,
      attachedVersionNumber: rider.attachedContractDocument?.versionNumber ?? null,
      attachedAt: rider.attachedAt,
      createdAt: rider.createdAt,
    })),
    obligations: obligations.map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      windowHours: row.windowHours,
      windowDays: row.windowDays,
      dayOfMonth: row.dayOfMonth,
      dueOn: row.dueOn ? row.dueOn.toISOString().slice(0, 10) : null,
      recipient: row.recipient,
      form: row.form,
      quote: row.quote,
      pageStart: row.pageStart,
    })),
    insurance: insurance.map((row) => ({
      id: row.id,
      coverage: row.coverage,
      coverageLabel: row.coverageLabel,
      limitPerOccurrence: row.limitPerOccurrence?.toNumber() ?? null,
      limitAggregate: row.limitAggregate?.toNumber() ?? null,
      endorsements: row.endorsements,
      completedOpsYears: row.completedOpsYears,
      notes: row.notes,
      quote: row.quote,
      pageStart: row.pageStart,
    })),
    proposedObligations: live.flatMap((f) => {
      const proposal = proposeObligation(f);
      return proposal ? [{ findingKey: f.key, quote: f.quote, pageStart: f.pageStart, proposal }] : [];
    }),
    proposedInsurance: live.flatMap((f) => {
      const proposal = proposeInsurance(f);
      return proposal ? [{ findingKey: f.key, quote: f.quote, pageStart: f.pageStart, proposal }] : [];
    }),
  };
}

/** The bid and job facts the scope check compares against. Reads only. */
async function loadBidSide(jobId: string, companyId: string) {
  const [job, bid, clauses, lines] = await Promise.all([
    prisma.job.findFirstOrThrow({
      where: { id: jobId, companyId },
      select: { retainagePercent: true, contact: { select: { defaultRetainagePercent: true } } },
    }),
    // wonJobId alone does not mean won — the schema's own warning.
    prisma.bidInvitation.findFirst({
      where: { companyId, wonJobId: jobId, status: "WON" },
      select: {
        projectName: true,
        bidAmount: true,
        lines: { select: { kind: true, label: true, description: true, amount: true, unit: true, unitPrice: true, accepted: true } },
        addenda: { select: { reference: true, acknowledgedOn: true, affectsPricedScope: true } },
      },
    }),
    prisma.jobProposalClause.findMany({ where: { jobId }, select: { id: true, kind: true, text: true } }),
    prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false }, select: { quantity: true, unitPrice: true } }),
  ]);
  const num = (value: { toNumber(): number } | null | undefined) => (value == null ? null : value.toNumber());
  return {
    bid: bid
      ? {
          projectName: bid.projectName,
          bidAmount: num(bid.bidAmount),
          lines: bid.lines.map((line) => ({
            kind: line.kind,
            label: line.label,
            description: line.description,
            amount: num(line.amount),
            unit: line.unit,
            unitPrice: num(line.unitPrice),
            accepted: line.accepted,
          })),
          addenda: bid.addenda,
        }
      : null,
    clauses,
    jobRetainagePercent: num(job.retainagePercent),
    gcDefaultRetainagePercent: num(job.contact.defaultRetainagePercent),
    // Σ quantity × unitPrice over live lines — ARCHITECTURE.md's job value, in cents.
    jobLineTotal: Math.round(lines.reduce((sum, line) => sum + line.quantity.toNumber() * (line.unitPrice?.toNumber() ?? 0) * 100, 0)) / 100,
  };
}
