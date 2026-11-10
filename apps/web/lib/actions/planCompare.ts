"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { actionFail, actionOk, ownerRefusal, type ActionResult, type ActionResultWith } from "./shared";
import { suggestPriorPlan } from "@/lib/takeoff/priorPlanLoad";

const SETTINGS_ONLY =
  "The company's settings aren't part of your job function. The account owner sets who sees what, on the Team page.";
/** The same words every takeoff action refuses with — the capability census reads the sentence, not the intent. */
const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

/** Plan comparison: OFF for every company until its owner ticks it — see `lib/takeoff/priorPlan.ts`. */
export async function savePlanCompareSwitch(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(SETTINGS_ONLY);
  const refusal = ownerRefusal(
    context,
    "Only the account owner can turn this on or off — it changes what every estimator sees on the takeoff.",
  );
  if (refusal) return refusal;
  const on = formData.get("planCompareOn") === "on";
  await prisma.company.update({ where: { id: context.company.id }, data: { planCompareOn: on } });
  revalidatePath("/settings");
  return actionOk;
}

/**
 * A person's choice of demolition plan for one sheet: another page, "none" to
 * remove the pairing, or "auto" to go back to the automatic one. Only the
 * choice is stored; the automatic pairing is derived every load.
 */
export async function savePriorPlanChoice(input: { jobId: string; planId: string; pageNumber: number; choice: "auto" | "none" | number }): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const plan = await prisma.takeoffPlan.findFirst({ where: { id: input.planId, jobId: input.jobId, companyId: context.company.id }, select: { id: true } });
  if (plan === null) return actionFail("That plan isn't on this job any more.");
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1) return actionFail("That isn't a sheet of this set.");
  if (typeof input.choice === "number" && (!Number.isInteger(input.choice) || input.choice < 1 || input.choice === input.pageNumber)) {
    return actionFail("Pick another sheet of this set as its demolition plan.");
  }
  const data =
    input.choice === "auto"
      ? { priorPage: null, priorPageChoice: null }
      : input.choice === "none"
        ? { priorPage: null, priorPageChoice: "none" }
        : { priorPage: input.choice, priorPageChoice: "user" };
  await prisma.takeoffPlanPage.upsert({
    where: { planId_pageNumber: { planId: plan.id, pageNumber: input.pageNumber } },
    create: { planId: plan.id, pageNumber: input.pageNumber, ...data },
    update: data,
  });
  revalidatePath(`/jobs/${input.jobId}`);
  return actionOk;
}

/**
 * The demolition plan to OFFER a sheet with no pairing (`suggestPriorPlan`):
 * the bar asks "Compare with A001?" and saves it, as the person's own choice,
 * only when they accept. Nothing is paired here.
 */
type PriorSuggestion = { demoPage: number; sheet: string; votes: number };
export async function suggestPriorPlanChoice(input: { jobId: string; planId: string; pageNumber: number }): Promise<ActionResultWith<PriorSuggestion | null>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return { ok: false, error: JOB_COSTS_ONLY };
  const plan = await prisma.takeoffPlan.findFirst({ where: { id: input.planId, jobId: input.jobId, companyId: context.company.id }, select: { id: true } });
  if (plan === null) return { ok: false, error: "That plan isn't on this job any more." };
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1) return { ok: false, error: "That isn't a sheet of this set." };
  try {
    return { ok: true, value: await suggestPriorPlan({ planId: plan.id, companyId: context.company.id, pageNumber: input.pageNumber }) };
  } catch (error) {
    console.error("[takeoff] demolition plan suggestion failed", { planId: plan.id, page: input.pageNumber }, error);
    return { ok: true, value: null };
  }
}

/** "Auto-post proven items": ON for a new company, OFF for existing ones until the owner ticks it — see `lib/takeoff/autoPost.ts`. */
export async function saveAutoPostSwitch(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(SETTINGS_ONLY);
  const refusal = ownerRefusal(context, "Only the account owner can turn this on or off — it changes what posts to every estimate without a review.");
  if (refusal) return refusal;
  const on = formData.get("autoPostOn") === "on";
  await prisma.company.update({ where: { id: context.company.id }, data: { autoPostOn: on } });
  revalidatePath("/settings");
  return actionOk;
}
