import { prisma } from "@prova/db";
import type { JobStepFacts } from "@/lib/job-steps";
import { loadReviewQueue } from "@/lib/takeoff/reviewQueueQuery";

/**
 * The facts `jobSteps` reads, for one job. Select-only and cheap: the job
 * layout runs it on every tab of an estimate, beside its own summary. The
 * takeoff counts are on the job's NEWEST plan set, the one the workspace
 * opens; a superseded set's scale and shapes do not make a step done. The
 * review count is the length of the job's one review queue (`reviewQueue.ts`).
 */
export async function loadJobStepFacts(companyId: string, jobId: string): Promise<JobStepFacts> {
  const queue = await loadReviewQueue(companyId, jobId);
  const [measurements, lineItemCount, signatures] = await Promise.all([
    queue.planId === null ? 0 : prisma.takeoffMeasurement.count({ where: { page: { planId: queue.planId } } }),
    prisma.jobLineItem.count({ where: { jobId, job: { companyId }, isDeleted: false } }),
    prisma.signatureRequest.findMany({ where: { jobId, job: { companyId } }, select: { status: true } }),
  ]);
  return {
    jobId,
    hasPlan: queue.planId !== null,
    scaledSheets: queue.scaledSheets,
    floorPlans: queue.floorPlans,
    floorPlansScaled: queue.floorPlansScaled,
    measurements,
    toReview: queue.items.length,
    lineItemCount,
    unpricedLines: queue.items.filter((item) => item.kind === "price").length,
    signatureStatuses: signatures.map((row) => row.status),
  };
}
