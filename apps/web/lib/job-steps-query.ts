import { prisma } from "@prova/db";
import { HELD_LABEL } from "@/lib/takeoff/estimateHold";
import type { JobStepFacts } from "@/lib/job-steps";
import { sheetIndexFor } from "@/lib/plan-ingest/sheetIndexQuery";
import { effectiveSheetNumber, effectiveTitle } from "@/lib/plan-ingest/sheetIndex";
import { sheetCategory } from "@/lib/takeoff/planSet";

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
  const [scaledPages, sheetRows, measurements, wallsToConfirm, lineItemCount, unpricedLines, signatures] = await Promise.all([
    plan === null ? [] : prisma.takeoffPlanPage.findMany({ where: { planId: plan.id, calibrations: { some: {} } }, select: { pageNumber: true } }),
    plan === null ? [] : sheetIndexFor(plan.id, companyId),
    onPlan === null ? 0 : prisma.takeoffMeasurement.count({ where: onPlan }),
    onPlan === null ? 0 : prisma.takeoffMeasurement.count({ where: { ...onPlan, label: HELD_LABEL } }),
    prisma.jobLineItem.count({ where: { jobId, job: { companyId }, isDeleted: false } }),
    prisma.jobLineItem.count({ where: { jobId, job: { companyId }, isDeleted: false, unitPrice: null, budgetedUnitCost: null } }),
    prisma.signatureRequest.findMany({ where: { jobId, job: { companyId } }, select: { status: true } }),
  ]);
  const scaled = new Set(scaledPages.map((row) => row.pageNumber));
  const floors = sheetRows
    .filter((row) => sheetCategory(effectiveSheetNumber(row), effectiveTitle(row), row.proposal?.pageType ?? null) === "floor")
    .map((row) => row.pageNumber);
  return {
    jobId,
    hasPlan: plan !== null,
    scaledSheets: scaledPages.length,
    floorPlans: floors.length,
    floorPlansScaled: floors.filter((page) => scaled.has(page)).length,
    measurements,
    wallsToConfirm,
    lineItemCount,
    unpricedLines,
    signatureStatuses: signatures.map((row) => row.status),
  };
}
