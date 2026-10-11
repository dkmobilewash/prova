"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail, actionOk, type ActionResult } from "./shared";

/**
 * Dismiss and restore an agent finding. Gated like /ai and /bids
 * (MANAGE_ESTIMATING), company-scoped through the WHERE so an id from
 * another company matches nothing. A dismissal records who and when;
 * restoring clears both. Nothing is deleted — a finding is a record of what
 * an agent said.
 */

const NO_ACCESS =
  "Agent findings aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** The forms do not router.refresh(), so every page that lists findings is
 *  revalidated here. The bracket form is how Next names a dynamic route. */
function revalidateFindingPages() {
  revalidatePath("/ai");
  revalidatePath("/ai/activity");
  revalidatePath("/ai/bids/[id]", "page");
}

export async function dismissFinding(id: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ACCESS);
  const { count } = await prisma.agentFinding.updateMany({
    where: { id, companyId: context.companyId, dismissedAt: null },
    data: { dismissedAt: new Date(), dismissedByUserId: context.id },
  });
  if (count === 0) return actionFail("That finding is already dismissed or no longer exists.");
  revalidateFindingPages();
  return actionOk;
}

export async function restoreFinding(id: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ACCESS);
  const { count } = await prisma.agentFinding.updateMany({
    where: { id, companyId: context.companyId, dismissedAt: { not: null } },
    data: { dismissedAt: null, dismissedByUserId: null },
  });
  if (count === 0) return actionFail("That finding is already open or no longer exists.");
  revalidateFindingPages();
  return actionOk;
}
