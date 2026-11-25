import type { Prisma } from "@prova/db";
import { deleteEmptyItems, syncReviewedItems } from "@/lib/estimating/takeoff-item-lines";
import { feetPerPageWidth } from "@/lib/takeoff-plan";

/**
 * ── DELETING A PLAN UPDATES THE ESTIMATE, AND SAYS SO FIRST (Diego, 2026-11-25) ──
 *
 * On main a plan delete cascaded its runs and counts away and left every estimate line as it was, so an estimate
 * kept pricing walls from a drawing that no longer existed (coordination/plan-delete-sync.md, R1-R9). This is the
 * whole of the delete. The confirmation's preview runs THIS function too, inside a transaction it rolls back, so
 * the numbers a person reads are the numbers this code produces (R8), never an estimate of them.
 */
export type PlanDeleteImpact = {
  /** The sheet label the person knows the plan by, else its file name. */
  label: string;
  /** False on a job past estimate: its estimate is the contract and changes only by change order (R6). */
  estimateUpdates: boolean;
  /** Feet of measured runs on the plan (walls and other lines), and the count marks (doors, windows, symbols). */
  wallFeet: number;
  counts: number;
  /** Estimate lines the delete retires, and the kept ones whose quantity moves (R1, R2). */
  linesRetired: number;
  linesChanged: { description: string; from: string; to: string }[];
  /** Takeoff lines priced by hand whose item the delete empties: kept as typed lines unless the person unticks (R4). */
  handPriced: { description: string; quantity: string; unitPrice: string | null; total: number }[];
  totalBefore: number;
  totalAfter: number;
  /** A signing link out with the GC: a PENDING one shows them the live estimate (R7). */
  signingLink: { status: "PENDING" | "SIGNED"; sentOn: string } | null;
};

const money = (lines: { quantity: { toString(): string }; unitPrice: { toString(): string } | null }[]) =>
  Math.round(lines.reduce((n, l) => n + Number(l.quantity) * Number(l.unitPrice ?? 0), 0) * 100) / 100;

/** The delete, inside the caller's transaction. Returns what it changed. */
export async function applyPlanDelete(
  tx: Prisma.TransactionClient,
  where: { companyId: string; jobId: string; planId: string },
  options: { keepHandPriced: boolean },
): Promise<PlanDeleteImpact | null> {
  const { companyId, jobId, planId } = where;
  const plan = await tx.takeoffPlan.findFirst({
    where: { id: planId, jobId, companyId },
    select: { fileName: true, job: { select: { status: true } }, pages: { orderBy: { pageNumber: "asc" }, take: 1, select: { label: true } } },
  });
  if (plan === null) return null;
  const estimateUpdates = plan.job.status === "ESTIMATE";

  const runs = await tx.takeoffMeasurement.findMany({
    where: { page: { planId } },
    select: { kind: true, xs: true, ys: true, itemId: true, calibration: { select: { x1: true, y1: true, x2: true, y2: true, declaredDistanceFeet: true } } },
  });
  let wallFeet = 0;
  let counts = 0;
  for (const run of runs) {
    if (run.kind === "COUNT") counts += run.xs.length;
    if (run.kind !== "LINEAR" || run.calibration === null) continue;
    const perWidth = feetPerPageWidth({ ...run.calibration, declaredDistanceFeet: Number(run.calibration.declaredDistanceFeet) });
    if (perWidth === null) continue;
    for (let i = 1; i < run.xs.length; i++) wallFeet += Math.hypot(run.xs[i]! - run.xs[i - 1]!, run.ys[i]! - run.ys[i - 1]!) * perWidth;
  }
  const touched = [...new Set(runs.flatMap((r) => (r.itemId === null ? [] : [r.itemId])))];

  const lineSelect = { id: true, description: true, quantity: true, unitPrice: true, budgetedUnitCost: true, sourceCatalogEntryId: true, takeoffItemId: true } as const;
  const before = await tx.jobLineItem.findMany({ where: { jobId, isDeleted: false }, select: lineSelect });

  // The items this delete empties: they had runs here and have none on any other plan (R3).
  const elsewhere = new Set(
    (await tx.takeoffMeasurement.findMany({ where: { itemId: { in: touched }, page: { planId: { not: planId } } }, select: { itemId: true }, distinct: ["itemId"] })).flatMap((m) => (m.itemId === null ? [] : [m.itemId])),
  );
  const emptied = touched.filter((id) => !elsewhere.has(id));

  // A price typed into a takeoff line is the one thing a sync leaves alone, so it is the thing a person can lose (R4).
  const handPriced = estimateUpdates
    ? before.filter((l) => l.takeoffItemId !== null && emptied.includes(l.takeoffItemId) && l.sourceCatalogEntryId === null && (l.unitPrice !== null || l.budgetedUnitCost !== null))
    : [];
  if (handPriced.length > 0) {
    // Kept as a typed line: unlinked, so it stays at its quantity and price and no later sync retires it. Unticked, it is
    // retired here: the sync no longer retires a hand-priced line (order (e), A1), it would only take it to 0.
    await tx.jobLineItem.updateMany({
      where: { id: { in: handPriced.map((l) => l.id) } },
      data: options.keepHandPriced ? { takeoffItemId: null, wallTypeComponentId: null } : { isDeleted: true, takeoffItemId: null, wallTypeComponentId: null },
    });
  }

  await tx.takeoffPlan.delete({ where: { id: planId } });

  if (estimateUpdates && touched.length > 0) {
    // #1253's batched sync: a fixed number of statements however many lines move (R1, R2).
    await syncReviewedItems(tx, companyId, jobId, touched);
    await deleteEmptyItems(tx, emptied, { jobId, companyId });
  }

  const after = await tx.jobLineItem.findMany({ where: { jobId, isDeleted: false }, select: lineSelect });
  const live = new Map(after.map((l) => [l.id, l]));
  const linesChanged = before.flatMap((l) => {
    const now = live.get(l.id);
    return now !== undefined && now.quantity.toString() !== l.quantity.toString() ? [{ description: l.description, from: l.quantity.toString(), to: now.quantity.toString() }] : [];
  });
  const link = await tx.signatureRequest.findFirst({ where: { jobId, revokedAt: null }, orderBy: { createdAt: "desc" }, select: { status: true, createdAt: true } });
  return {
    label: plan.pages[0]?.label?.trim() || plan.fileName || "this plan",
    estimateUpdates,
    wallFeet: Math.round(wallFeet),
    counts,
    linesRetired: before.filter((l) => !live.has(l.id)).length,
    linesChanged,
    handPriced: handPriced.map((l) => ({ description: l.description, quantity: l.quantity.toString(), unitPrice: l.unitPrice?.toString() ?? null, total: money([l]) })),
    totalBefore: money(before),
    totalAfter: money(after),
    signingLink: link === null ? null : { status: link.status, sentOn: link.createdAt.toISOString().slice(0, 10) },
  };
}
