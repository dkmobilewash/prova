"use server";

import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { recordTakeoffEvents } from "@/lib/takeoff/events";
import { groupTarget, type TargetRun } from "@/lib/takeoff/eventTarget";
import { actionFail, actionOk, type ActionResult } from "./shared";

/**
 * The review queue's Skip, recorded (`TakeoffEvent`). Skip changes nothing on the
 * job, so it is the one queue press that needs its own call. The job is found only
 * among the person's own company's; the target is computed here from the runs.
 */
export async function recordQueueSkip(jobId: string, input: { planId?: string | null; pageNumber?: number | null; runs?: TargetRun[] }): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail("Reviewing a takeoff isn't part of your job function.");
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId: context.company.id }, select: { id: true } });
  if (!job) return actionFail("That job is no longer here. Reload the page.");
  const planId = typeof input?.planId === "string" ? input.planId : null;
  const pageNumber = Number.isInteger(input?.pageNumber) ? (input.pageNumber as number) : null;
  const runs = Array.isArray(input?.runs) ? input.runs.filter((r) => [r?.x1, r?.y1, r?.x2, r?.y2].every(Number.isFinite)).slice(0, 2000) : [];
  await recordTakeoffEvents([
    { companyId: context.company.id, jobId, kind: "SKIP", planId, pageNumber, target: planId && pageNumber && runs.length ? groupTarget(planId, pageNumber, runs) : null, userId: context.id },
  ]);
  return actionOk;
}
