import { prisma } from "@prova/db";
import { wallItemsForSheet } from "@/lib/plan-ingest/wallItems";
import { isHeldRun, PERSON_LABELS } from "./estimateHold";
import { detectWallsForCalibration, type DetectTarget } from "./detectWallsForCalibration";

/**
 * ── AN EXCLUSION MADE AFTER THE WALLS WERE POSTED STILL HAS TO REACH THE ESTIMATE ──
 *
 * The stage reads `TakeoffSheetExclusion` when it detects, which covers an
 * exclusion made before a whole-set run. One made after finds the sheet's
 * walls already stored, and `wallItemsForSheet` refuses a sheet that has
 * them. So detect again, and replace the sheet's DETECTED rows from the new
 * proposals.
 *
 * Nothing already POSTED to the estimate is moved: one posted row leaves the
 * whole sheet alone and the answer says so, because taking walls out of a
 * sent number is a person's decision.
 *
 * ── AND EVERY RUN THAT SURVIVES KEEPS WHERE IT WAS ──
 *
 * The re-detection used to write without the hold, so a work area turned every
 * "to confirm" run into an untyped one on the estimate (Baker A101: 29 ft to
 * confirm became 0, Chrome round 5). It now holds what the model doubts, as the
 * whole-set run does, and a run a PERSON decided (kept or dropped) goes back on
 * the item and label they gave it. Every other label is the model's, read again:
 * keeping those too kept the untyped labels the old bug wrote, so Baker A101
 * showed 0 to confirm however often it was found again (Chrome round 6).
 */
type Line = { x1: number; y1: number; x2: number; y2: number };
const lineOf = (m: { xs: number[]; ys: number[] }): Line => ({ x1: m.xs[0] ?? NaN, y1: m.ys[0] ?? NaN, x2: m.xs[1] ?? NaN, y2: m.ys[1] ?? NaN });

export type RefreshOutcome = { kind: "replaced" | "emptied" | "proposals-only" | "posted-left-alone" | "failed" };

export async function refreshSheetWalls(target: DetectTarget & { jobId: string; userId: string | null }): Promise<RefreshOutcome> {
  let held: readonly Line[] = [];
  const outcome = await detectWallsForCalibration({ ...target, onBoundary: (seen) => (held = seen.held) });
  if (outcome !== "written" && outcome !== "nothing-found") return { kind: "failed" };
  // Nothing left on the sheet writes no proposals, so the old ones would stand.
  if (outcome === "nothing-found") await prisma.takeoffWallProposal.deleteMany({ where: { pageId: target.pageId, calibrationId: target.calibrationId } });
  const detected = { pageId: target.pageId, source: "DETECTED" as const, kind: "LINEAR" as const };
  const total = await prisma.takeoffMeasurement.count({ where: detected });
  if (total === 0) return { kind: "proposals-only" };
  const posted = await prisma.takeoffMeasurement.count({ where: { ...detected, postedAt: { not: null } } });
  if (posted > 0) return { kind: "posted-left-alone" };
  const before = await prisma.takeoffMeasurement.findMany({ where: detected, select: { xs: true, ys: true, itemId: true, label: true } });
  await prisma.takeoffMeasurement.deleteMany({ where: detected });
  if (outcome === "nothing-found") return { kind: "emptied" };
  await wallItemsForSheet({ planId: target.planId, companyId: target.companyId, jobId: target.jobId, pageNumber: target.pageNumber, userId: target.userId, held });
  const after = await prisma.takeoffMeasurement.findMany({ where: detected, select: { id: true, xs: true, ys: true, itemId: true, label: true } });
  for (const row of after) {
    const was = before.find((old) => old.label !== null && PERSON_LABELS.includes(old.label) && isHeldRun(lineOf(old), [lineOf(row)]));
    if (was && (was.itemId !== row.itemId || was.label !== row.label)) {
      await prisma.takeoffMeasurement.update({ where: { id: row.id }, data: { itemId: was.itemId, label: was.label } });
    }
  }
  return { kind: "replaced" };
}
