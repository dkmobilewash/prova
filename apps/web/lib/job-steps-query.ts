import { prisma } from "@prova/db";
import { HELD_LABEL } from "@/lib/takeoff/estimateHold";
import type { JobStepFacts } from "@/lib/job-steps";

/**
 * The facts `jobSteps` reads, for one job, in five counts. Select-only and
 * cheap: the job layout runs it on every tab of an estimate, beside its own
 * summary. The takeoff counts are on the job's NEWEST plan set, the one the
 * workspace opens; a superseded set's scale and shapes do not make a step done.
 */
export async function loadJobStepFacts(companyId: string, jobId: string): Promise<JobStepFacts> {
  const plan = await prisma.takeoffPlan.findFirst({
    where: { jobId, companyId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const onPlan = plan === null ? null : { page: { planId: plan.id } };
  const [scaledSheets, measurements, wallsToConfirm, lineItemCount, signatures] = await Promise.all([
    plan === null ? 0 : prisma.takeoffPlanPage.count({ where: { planId: plan.id, calibrations: { some: {} } } }),
    onPlan === null ? 0 : prisma.takeoffMeasurement.count({ where: onPlan }),
    onPlan === null ? 0 : prisma.takeoffMeasurement.count({ where: { ...onPlan, label: HELD_LABEL } }),
    prisma.jobLineItem.count({ where: { jobId, job: { companyId }, isDeleted: false } }),
    prisma.signatureRequest.findMany({ where: { jobId, job: { companyId } }, select: { status: true } }),
  ]);
  return {
    jobId,
    hasPlan: plan !== null,
    scaledSheets,
    measurements,
    wallsToConfirm,
    lineItemCount,
    signatureStatuses: signatures.map((row) => row.status),
  };
}
