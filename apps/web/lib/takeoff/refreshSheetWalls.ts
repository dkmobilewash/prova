import { prisma } from "@prova/db";
import { wallItemsForSheet } from "@/lib/plan-ingest/wallItems";
import type { Prisma } from "@prova/db";
import { personDecided } from "./estimateHold";
import { liesMostlyOn, matchWallRuns } from "./runMatch";
import { detectWallsForCalibration, oneFinderSlot, type DetectTarget } from "./detectWallsForCalibration";

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

export type RefreshOutcome =
  | { kind: "emptied" | "posted-left-alone" | "failed" }
  /** `needsLook`: person decisions the new reading has no wall for, kept exactly as they were. */
  | { kind: "replaced"; needsLook: number }
  /** Found again, and nothing of the sheet's is on the job yet: the run posts it, with the runs held to confirm. */
  | { kind: "proposals-only"; held?: readonly Line[] };

export async function refreshSheetWalls(target: DetectTarget & { jobId: string; userId: string | null }): Promise<RefreshOutcome> {
  let held: readonly Line[] = [];
  // Somebody pressed for it: the one finder slot, at the front.
  const outcome = await oneFinderSlot(() => detectWallsForCalibration({ ...target, onBoundary: (seen) => (held = seen.held) }), `${target.planId}:${target.pageNumber}`, true);
  if (outcome !== "written" && outcome !== "nothing-found") return { kind: "failed" };
  // Nothing left on the sheet writes no proposals, so the old ones would stand.
  if (outcome === "nothing-found") await prisma.takeoffWallProposal.deleteMany({ where: { pageId: target.pageId, calibrationId: target.calibrationId } });
  const detected = { pageId: target.pageId, source: "DETECTED" as const, kind: "LINEAR" as const };
  const total = await prisma.takeoffMeasurement.count({ where: detected });
  if (total === 0) return { kind: "proposals-only", held };
  const posted = await prisma.takeoffMeasurement.count({ where: { ...detected, postedAt: { not: null } } });
  if (posted > 0) return { kind: "posted-left-alone" };
  const before = await prisma.takeoffMeasurement.findMany({ where: detected });
  // A reading that found nothing takes the model's rows away and leaves a person's.
  if (outcome === "nothing-found") {
    await prisma.takeoffMeasurement.deleteMany({ where: { id: { in: before.filter((old) => !personDecided(old.label)).map((old) => old.id) } } });
    return { kind: "emptied" };
  }
  await prisma.takeoffMeasurement.deleteMany({ where: detected });
  await wallItemsForSheet({ planId: target.planId, companyId: target.companyId, jobId: target.jobId, pageNumber: target.pageNumber, userId: target.userId, held });
  const after = await prisma.takeoffMeasurement.findMany({ where: detected, select: { id: true, xs: true, ys: true, itemId: true, label: true } });
  // ── A PERSON'S DECISION IS NEVER DELETED OR SILENTLY RESET (prereg-reattach-P0.md) ──
  //
  // This matched to 1e-9, so after a finder deploy that moved a run's end, a
  // person's kept or dropped was gone: a dropped wall went back on the estimate.
  // Now every person-decided row (kept, dropped, typed by hand) goes to the new
  // row that is the same wall (`matchWallRuns`: 5°, offset, 60% overlap, best
  // overlap first, one each) and gives it its label and item. One the new reading
  // has no wall for is written back exactly as it was, and any new row lying
  // mostly along it is taken away, so a dropped wall cannot come back as pieces.
  // Those are "needs a look", which is derived on read and never stored.
  const people = before.filter((old) => personDecided(old.label));
  const pairs = matchWallRuns(people, after, lineOf, lineOf, target.feetPerUnit);
  let needsLook = 0;
  for (const old of people) {
    const row = pairs.get(old.id);
    if (row !== undefined) {
      if (old.itemId !== row.itemId || old.label !== row.label) {
        await prisma.takeoffMeasurement.update({ where: { id: row.id }, data: { itemId: old.itemId, label: old.label } });
      }
      continue;
    }
    needsLook += 1;
    const matched = new Set([...pairs.values()].map((f) => f.id));
    const under = after.filter((f) => !matched.has(f.id) && liesMostlyOn(lineOf(f), lineOf(old), target.feetPerUnit)).map((f) => f.id);
    if (under.length > 0) await prisma.takeoffMeasurement.deleteMany({ where: { id: { in: under } } });
    const { id: _id, cutouts, openings, ...rest } = old;
    await prisma.takeoffMeasurement.create({ data: { ...rest, cutouts: cutouts as Prisma.InputJsonValue, openings: openings as Prisma.InputJsonValue } });
  }
  return { kind: "replaced", needsLook };

}
