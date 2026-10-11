"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail, actionOk, type ActionResult } from "./shared";

/**
 * A person closing a recommendation. Both write only the AiRecommendation
 * row; neither does the thing it recommends. Stamped with who, so the
 * engine knows a person closed it and does not reopen it on the next run.
 * Gated like /ai (MANAGE_ESTIMATING).
 */

async function resolve(id: string, status: "dismissed" | "done", verb: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return actionFail(`${verb} a recommendation isn't part of your job function. The account owner sets who sees what, on the Team page.`);
  }
  if (typeof id !== "string" || !id) return actionFail("Which recommendation?");
  const updated = await prisma.aiRecommendation.updateMany({
    where: { id, companyId: context.companyId },
    data: { status, resolvedAt: new Date(), resolvedByUserId: context.id },
  });
  if (updated.count === 0) return actionFail("That recommendation isn't on your account.");
  revalidatePath("/ai");
  revalidatePath("/ai/bids/[id]", "page");
  return actionOk;
}

export async function dismissRecommendation(id: string): Promise<ActionResult> {
  return resolve(id, "dismissed", "Dismissing");
}

export async function markRecommendationDone(id: string): Promise<ActionResult> {
  return resolve(id, "done", "Closing");
}
