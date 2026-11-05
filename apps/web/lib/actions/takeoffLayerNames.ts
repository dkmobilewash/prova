"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isLayerKey, LAYER_NAME_MAX } from "@/lib/takeoff/layerKey";
import { actionFail, actionOk, type ActionResult } from "./shared";

const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * ── NAME A TAKEOFF LAYER FOR THE WHOLE TEAM ──
 *
 * One name per job and layer key (`TakeoffLayerName`). An empty name clears
 * it, and the layer goes back to its default ("A1 · 4-7/8″"). The same
 * capability as taking items off, since it is the same work.
 */
export async function renameTakeoffLayer(jobId: string, groupKey: string, name: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  if (!isLayerKey(groupKey)) return actionFail("That layer can't be named. Reload the page and try again.");
  const trimmed = name.trim();
  if (trimmed.length > LAYER_NAME_MAX) return actionFail(`Keep a layer name under ${LAYER_NAME_MAX} characters.`);
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId: context.company.id }, select: { id: true } });
  if (!job) return actionFail("That job is no longer here. Reload the page.");

  if (trimmed === "") {
    await prisma.takeoffLayerName.deleteMany({ where: { jobId, groupKey } });
  } else {
    await prisma.takeoffLayerName.upsert({
      where: { jobId_groupKey: { jobId, groupKey } },
      create: { jobId, groupKey, name: trimmed, updatedByUserId: context.id },
      update: { name: trimmed, updatedByUserId: context.id },
    });
  }
  revalidatePath(`/takeoff/${jobId}`);
  return actionOk;
}
