"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail, actionOk, ownerRefusal, type ActionResult } from "./shared";

const SETTINGS_ONLY =
  "The company's settings aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** "Count like this": ON for every company unless its owner turns it off — the box ticked means on, stored as `symbolCountOff: false`. */
export async function saveSymbolCountSwitch(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(SETTINGS_ONLY);
  const refusal = ownerRefusal(
    context,
    "Only the account owner can turn this on or off — it changes what every estimator sees on the takeoff.",
  );
  if (refusal) return refusal;
  const on = formData.get("symbolCountOn") === "on";
  await prisma.company.update({ where: { id: context.company.id }, data: { symbolCountOff: !on } });
  revalidatePath("/settings");
  return actionOk;
}
