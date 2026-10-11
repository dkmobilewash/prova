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

const NO_ACCESS = "Closing a recommendation isn't part of your job function. The account owner sets who sees what, on the Team page.";

// The capability check sits INSIDE each export rather than in the shared
// helper: action-capability-guards reads an exported action's own body for
// the guard, and a check it cannot see is a check it cannot keep.
async function resolve(
  context: { companyId: string; id: string },
  id: string,
  status: "dismissed" | "done",
): Promise<ActionResult> {
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
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ACCESS);
  return resolve(context, id, "dismissed");
}

export async function markRecommendationDone(id: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ACCESS);
  return resolve(context, id, "done");
}
