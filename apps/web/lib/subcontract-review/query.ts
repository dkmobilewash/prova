import { prisma } from "@prova/db";
import { applyDecisions, diffFindings, type DecisionView, type DiffEntry, type FindingView, type ReviewedFinding } from "./findings";
import { SOURCE_ROLE_LABEL, type SourceRole } from "./run";

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
};

export type VersionOption = { id: string; versionNumber: number; fileName: string; executed: boolean };

export type ReviewPageData = {
  job: { id: string; name: string };
  versions: VersionOption[];
  selected: VersionOption | null;
  review: ReviewView | null;
  /** The newest COMPLETED review of an EARLIER version, and the diff against it. */
  previous: { versionNumber: number; reviewId: string; diff: DiffEntry<ReviewedFinding>[] } | null;
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
  contractDocument: { select: { versionNumber: true } },
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
  };
}

export async function loadReviewPage(
  jobId: string,
  companyId: string,
  versionId: string | undefined,
): Promise<ReviewPageData | null> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId },
    select: {
      id: true,
      name: true,
      contractDocuments: {
        orderBy: { versionNumber: "desc" },
        select: { id: true, versionNumber: true, fileName: true, executedSignedDate: true },
      },
    },
  });
  if (!job) return null;

  const versions: VersionOption[] = job.contractDocuments.map((doc) => ({
    id: doc.id,
    versionNumber: doc.versionNumber,
    fileName: doc.fileName,
    executed: doc.executedSignedDate !== null,
  }));
  const selected = versions.find((version) => version.id === versionId) ?? versions[0] ?? null;
  if (!selected) return { job: { id: job.id, name: job.name }, versions, selected: null, review: null, previous: null };

  const [row, decisionRows] = await Promise.all([
    loadReviewRow({ where: { contractDocumentId: selected.id, jobId: job.id }, orderBy: { startedAt: "desc" } }),
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

  return { job: { id: job.id, name: job.name }, versions, selected, review, previous };
}
