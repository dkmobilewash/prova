"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { MAX_ATTEMPTS } from "@/lib/plan-ingest/runner";
import { planOfWorkQuestion, uploadProjectQuestion, wholeSetSummary, type WallsSummaryRow } from "@/lib/plan-ingest/walls";
import { actionFail, actionOk, ownerRefusal, type ActionResult, type ActionResultWith } from "./shared";

/**
 * ── WHOLE-SET TAKEOFF: THE SWITCH AND THE SUMMARY ──
 *
 * The run itself is `startPlanIngest(planId, "WALLS")` and `advancePlanIngest`,
 * the same actions every other ingest stage uses — see `lib/plan-ingest/walls.ts`.
 * These two are what is specific: the owner's switch, OFF for every company
 * until turned on (the room-finder posture, same reasons), and the per-sheet
 * summary the panel lists once a run is done.
 */

const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";
const SETTINGS_ONLY =
  "The company's settings aren't part of your job function. The account owner sets who sees what, on the Team page.";

export async function saveWholeSetTakeoffSwitch(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_COMPLIANCE")) return actionFail(SETTINGS_ONLY);
  const refusal = ownerRefusal(
    context,
    "Only the account owner can turn whole-set wall finding on or off — it changes what every estimator sees on the takeoff.",
  );
  if (refusal) return refusal;
  const on = formData.get("wholeSetTakeoffOn") === "on";
  await prisma.company.update({ where: { id: context.company.id }, data: { wholeSetTakeoffOn: on } });
  revalidatePath("/settings");
  return actionOk;
}

export async function wholeSetTakeoffSummary(planId: string): Promise<ActionResultWith<WallsSummaryRow[]>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY) as ActionResultWith<WallsSummaryRow[]>;
  const plan = await prisma.takeoffPlan.findFirst({ where: { id: planId, companyId: context.company.id, deletedAt: null }, select: { id: true } });
  if (!plan) return { ok: false, error: "That plan set could not be found." };
  return { ok: true, value: await wholeSetSummary(plan.id, context.company.id, MAX_ATTEMPTS) };
}

/**
 * The user's answer to "this upload has drawings from more than one project — which one are you bidding?"
 * (`lib/plan-ingest/projectIdentity.ts`). Named by one page of the chosen project; the server works out the project
 * again and stores ITS pages, so a stale or hand-made page list cannot choose anything the question did not offer.
 */
export async function chooseUploadProject(planId: string, pageNumber: number): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const plan = await prisma.takeoffPlan.findFirst({ where: { id: planId, companyId: context.company.id }, select: { id: true, jobId: true } });
  if (!plan) return actionFail("That plan set could not be found.");
  const question = await uploadProjectQuestion(plan.id, context.company.id);
  const group = question?.groups.find((g) => g.pages.includes(pageNumber));
  if (!group) return actionFail("That project is no longer one of this upload's choices. Reload the page and choose again.");
  await prisma.takeoffPlan.update({ where: { id: plan.id, deletedAt: null }, data: { projectPages: group.pages } });
  revalidatePath(`/jobs/${plan.jobId}/takeoff`);
  return actionOk;
}

/**
 * The user's answer to "the run found no floor plan to count — which sheet(s) are the plan of the work?"
 * (`planOfWork` in `lib/plan-ingest/walls.ts`). Every page must be one the question offers, worked out again here,
 * so a stale or hand-made list cannot make the run count a sheet the question did not offer.
 */
export async function choosePlanOfWork(planId: string, pageNumbers: number[]): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const plan = await prisma.takeoffPlan.findFirst({ where: { id: planId, companyId: context.company.id }, select: { id: true, jobId: true } });
  if (!plan) return actionFail("That plan set could not be found.");
  const pages = [...new Set(pageNumbers)];
  if (pages.length === 0) return actionFail("Choose at least one sheet that shows the work.");
  const question = await planOfWorkQuestion(plan.id, context.company.id);
  if (!question || !pages.every((page) => question.candidates.includes(page))) {
    return actionFail("Those sheets are no longer this upload's choices. Reload the page and choose again.");
  }
  await prisma.takeoffPlan.update({ where: { id: plan.id, deletedAt: null }, data: { planOfWorkPages: pages.sort((a, b) => a - b) } });
  revalidatePath(`/jobs/${plan.jobId}/takeoff`);
  return actionOk;
}
