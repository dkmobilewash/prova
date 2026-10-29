"use server";

import { prisma } from "@prova/db";
import { revalidatePath } from "next/cache";
import { AI_FEATURE_LABEL, aiFeatureEnum } from "@/lib/ai/features";
import { aiSettingsFor } from "@/lib/ai/settings";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail, actionOk, ownerRefusal, type ActionResult } from "./shared";

/**
 * "Wall types from the drawings" from the Takeoff features list. It is an
 * opt-in AI feature, so on its own page it needs two ticks in order —
 * company AI on, then the feature — and the pilot found that reads like a
 * bug once you have ticked "AI". Turning it on HERE does both: AI on and the
 * feature opted in, in one save, touching nothing else in the company's AI
 * settings. Turning it off takes the feature out of the opt-in list and
 * leaves AI as it was, because AI is the Ask box too.
 *
 * What it cannot do is give the server a model key; the row says so.
 */
const SETTINGS_ONLY =
  "The company's settings aren't part of your job function. The account owner sets who sees what, on the Team page.";

export async function setWallTypesFromDrawings(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(SETTINGS_ONLY);
  const refusal = ownerRefusal(context, `Only the account owner can turn "${AI_FEATURE_LABEL.PLAN_TEXT_READ}" on or off.`);
  if (refusal) return refusal;
  const on = formData.get("wallTypesFromDrawings") === "on";
  const companyId = context.company.id;
  const current = await aiSettingsFor(companyId);
  const feature = aiFeatureEnum("PLAN_TEXT_READ");
  const optedIn = (current.optedInFeatures ?? []).filter((f) => f !== feature);
  if (on) optedIn.push(feature);
  const settings = {
    aiEnabled: on ? true : current.aiEnabled,
    disabledFeatures: current.disabledFeatures,
    optedInFeatures: optedIn,
    modelOverride: current.modelOverride ?? null,
    updatedByUserId: context.id,
  };
  await prisma.companyAiSettings.upsert({ where: { companyId }, create: { companyId, ...settings }, update: settings });
  revalidatePath("/settings");
  revalidatePath("/settings/assistant");
  return actionOk;
}
