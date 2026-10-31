"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail, actionOk, ownerRefusal, type ActionResult } from "./shared";

const SETTINGS_ONLY =
  "The company's settings aren't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * The per-company switch for "demote, don't hide" on the takeoff. Same
 * posture as the room finder: OFF until the owner turns it on, saved by the
 * owner only, read by `loadTakeoffWorkspace` so the viewer's behaviour is
 * decided by the same load as everything else on the screen.
 */
export async function saveDemotedWallsSwitch(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(SETTINGS_ONLY);
  const refusal = ownerRefusal(
    context,
    "Only the account owner can turn this on or off — it changes what every estimator sees on the takeoff.",
  );
  if (refusal) return refusal;
  // The form still posts "on"/absent for a box labelled as the feature, which
  // is what a person reads. The COLUMN is the negation, because the default
  // had to be on without rewriting anybody's row.
  const on = formData.get("demotedWallsOn") === "on";
  await prisma.company.update({ where: { id: context.company.id }, data: { demotedWallsOff: !on } });
  revalidatePath("/settings");
  return actionOk;
}
