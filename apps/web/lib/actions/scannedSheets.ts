"use server";

import { prisma } from "@prova/db";
import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail, actionOk, ownerRefusal, type ActionResult } from "./shared";

/**
 * The per-company switch for reading scanned sheets as lines and text (the
 * RASTER ingest stage). OFF until the owner ticks it; same posture as the
 * room finder and "demote, don't hide". Not an AI feature: no model is
 * called, so it is on `Company` and not in the AI settings.
 */
const SETTINGS_ONLY =
  "The company's settings aren't part of your job function. The account owner sets who sees what, on the Team page.";

export async function saveScannedPlansSwitch(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(SETTINGS_ONLY);
  const refusal = ownerRefusal(
    context,
    "Only the account owner can turn scanned-sheet reading on or off — it changes what every estimator sees on the takeoff.",
  );
  if (refusal) return refusal;
  const on = formData.get("scannedPlansOn") === "on";
  await prisma.company.update({ where: { id: context.company.id }, data: { scannedPlansOn: on } });
  revalidatePath("/settings");
  return actionOk;
}
