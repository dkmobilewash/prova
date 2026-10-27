"use server";

import { prisma } from "@prova/db";
import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail, actionOk, ownerRefusal, type ActionResult } from "./shared";

/**
 * The per-company switch for the takeoff summary export (CSV + PDF of
 * quantities, no prices). OFF until the owner ticks it, same posture as the
 * room finder: not an AI feature, so on `Company` rather than in the AI
 * settings. The export itself is a Route Handler (`app/api/takeoff-summary`)
 * because it returns a FILE; this module is only the switch.
 */
const SETTINGS_ONLY =
  "The company's settings aren't part of your job function. The account owner sets who sees what, on the Team page.";

export async function saveTakeoffExportSwitch(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(SETTINGS_ONLY);
  const refusal = ownerRefusal(
    context,
    "Only the account owner can turn the takeoff export on or off — it changes what every estimator can download.",
  );
  if (refusal) return refusal;
  const on = formData.get("takeoffExportOn") === "on";
  await prisma.company.update({ where: { id: context.company.id }, data: { takeoffExportOn: on } });
  revalidatePath("/settings");
  return actionOk;
}
