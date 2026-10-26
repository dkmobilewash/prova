"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { NOT_ESTIMATE_STAGE } from "@/lib/estimating/draft-lines";
import { lineWrite, planPriceRefresh, updateToken, type RefreshPlan } from "@/lib/estimating/price-refresh";
import { actionFail, type ActionResultWith } from "./shared";

/**
 * "Update prices on this estimate" — the preview and the write.
 *
 * MANAGE_ESTIMATING and an ESTIMATE-stage job (the price book is the estimating
 * capability's; the stage gate is the same as every other
 * estimate-tab write). A CONTRACTED job is refused outright: its
 * lines are the subcontract, and a price change after signing is a change
 * order, never a refresh.
 *
 * NOT OWNER-ONLY, deliberately. It edits the job's own lines, which an
 * estimator can already edit one at a time; what it adds is doing many at once,
 * so the protection is the two-step shape — the preview lists every line with
 * old -> new, nothing is ticked that the person did not see, and the write
 * re-derives everything from the database and refuses if the price book moved
 * between the preview and the confirm.
 *
 * NOTHING COMES FROM THE REQUEST BUT WHICH LINES. The new figures are re-read
 * from the price book here; `signature` only proves the person confirmed the
 * numbers they were shown.
 */

const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";
const NO_JOB = "That job isn't on your account any more.";
const NO_ESTIMATING =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";

async function loadPlan(jobId: string, companyId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, companyId },
    select: { id: true, status: true, bidRecap: { select: { appliedAt: true } } },
  });
  if (!job) return { ok: false as const, error: NO_JOB };
  if (job.status !== "ESTIMATE") return { ok: false as const, error: NOT_ESTIMATE_STAGE };

  const rows = await prisma.jobLineItem.findMany({
    where: { jobId, isDeleted: false },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      description: true,
      quantity: true,
      unit: true,
      unitPrice: true,
      budgetedUnitCost: true,
      currentEstimatedUnitCost: true,
      sourceCatalogEntryId: true,
    },
  });
  const entryIds = [...new Set(rows.map((row) => row.sourceCatalogEntryId).filter((id): id is string => !!id))];
  const entries = entryIds.length
    ? await prisma.lineItemCatalogEntry.findMany({
        where: { id: { in: entryIds }, companyId },
        select: { id: true, unit: true, defaultUnitPrice: true, defaultBudgetedUnitCost: true },
      })
    : [];
  const n = (v: { toString(): string } | null) => (v == null ? null : Number(v));
  const lines = rows.map((row) => ({
    id: row.id,
    description: row.description,
    quantity: Number(row.quantity),
    unit: row.unit,
    unitPrice: n(row.unitPrice),
    budgetedUnitCost: n(row.budgetedUnitCost),
    currentEstimatedUnitCost: n(row.currentEstimatedUnitCost),
    sourceCatalogEntryId: row.sourceCatalogEntryId,
  }));
  const plan = planPriceRefresh(
    lines,
    entries.map((entry) => ({
      id: entry.id,
      unit: entry.unit,
      defaultUnitPrice: n(entry.defaultUnitPrice),
      defaultBudgetedUnitCost: n(entry.defaultBudgetedUnitCost),
    })),
    { recapApplied: job.bidRecap?.appliedAt != null },
  );
  return { ok: true as const, plan, lines };
}

/** What the person is confirming: each selected line and the figures it will take. */
function signatureOf(plan: RefreshPlan, lineIds: readonly string[]): string {
  const selected = new Set(lineIds);
  return plan.updates
    .filter((update) => selected.has(update.lineId))
    .map(updateToken)
    .sort()
    .join("|");
}

export type PriceRefreshPreview = { plan: RefreshPlan };

export async function previewEstimatePriceUpdate(jobId: string): Promise<ActionResultWith<PriceRefreshPreview>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  const loaded = await loadPlan(jobId, context.company.id);
  if (!loaded.ok) return actionFail(loaded.error);
  return { ok: true, value: { plan: loaded.plan } };
}

export async function applyEstimatePriceUpdate(
  jobId: string,
  lineIds: string[],
  signature: string,
): Promise<ActionResultWith<{ updated: number }>> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  if (!can(context, "MANAGE_ESTIMATING")) return actionFail(NO_ESTIMATING);
  const companyId = context.company.id;
  if (!Array.isArray(lineIds) || lineIds.length === 0) {
    return actionFail("Tick at least one line to update.");
  }

  const loaded = await loadPlan(jobId, companyId);
  if (!loaded.ok) return actionFail(loaded.error);
  const { plan, lines } = loaded;
  if (signatureOf(plan, lineIds) !== signature) {
    return actionFail(
      "The price book or this estimate changed since you opened the list, so what you confirmed is no longer what would be written. Close it and press Update prices again.",
    );
  }

  const selected = new Set(lineIds);
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const chosen = plan.updates.filter((update) => selected.has(update.lineId));
  await prisma.$transaction(
    chosen.map((update) =>
      prisma.jobLineItem.updateMany({
        // jobId and isDeleted in the where: a line moved or removed since the
        // read is skipped rather than written to.
        where: { id: update.lineId, jobId, isDeleted: false },
        data: lineWrite(update, lineById.get(update.lineId)!),
      }),
    ),
  );

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/estimate`);
  return { ok: true, value: { updated: chosen.length } };
}
