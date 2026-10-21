"use server";

import { prisma } from "@prova/db";
import { aiGate } from "@/lib/ai/settings";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { readLegend, readSheetResult, type PlanTextLegend, type PlanTextSheetResult } from "@/lib/takeoff/planTextRead";
import type { ActionResultWith } from "./shared";

/**
 * What the takeoff screen asks for after a sheet's groups load: the plan-text
 * result for that sheet and the set's legend proposals. A READ of the file
 * cache and nothing else. `value: null` means the switch is off, or detection
 * has not run on that page yet — both render as "nothing to show", which is
 * the only honest rendering of either. A plan that is not this company's
 * reads the same as one with nothing in it, deliberately.
 *
 * The capability is the takeoff page's own, asserted here before anything
 * is read, because the action is its own endpoint and answers whoever posts
 * to it — `action-capability-guards.test.ts`.
 */
export type PlanTextView = {
  sheet: PlanTextSheetResult | null;
  legend: PlanTextLegend | null;
};

const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

export async function loadPlanText(
  jobId: string,
  planId: string,
  pageNumber: number,
): Promise<ActionResultWith<PlanTextView | null>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return { ok: false, error: JOB_COSTS_ONLY };
  if (!(await aiGate(context.company.id, "PLAN_TEXT_READ")).ok) return { ok: true, value: null };
  const plan = await prisma.takeoffPlan.findFirst({
    where: { id: planId, jobId, job: { companyId: context.company.id } },
    select: { id: true },
  });
  if (plan === null) return { ok: true, value: null };
  return { ok: true, value: { sheet: await readSheetResult(planId, pageNumber), legend: await readLegend(planId) } };
}
