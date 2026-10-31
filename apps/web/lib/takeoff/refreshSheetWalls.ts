import { prisma } from "@prova/db";
import { wallItemsForSheet } from "@/lib/plan-ingest/wallItems";
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
 * sent number is a person's decision. A re-assignment of an unposted DETECTED
 * run to another item is lost in the replace; the PR says so.
 */
export type RefreshOutcome = { kind: "replaced" | "emptied" | "proposals-only" | "posted-left-alone" | "failed" };

export async function refreshSheetWalls(target: DetectTarget & { jobId: string; userId: string | null }): Promise<RefreshOutcome> {
  const outcome = await detectWallsForCalibration(target);
  if (outcome !== "written" && outcome !== "nothing-found") return { kind: "failed" };
  // Nothing left on the sheet writes no proposals, so the old ones would stand.
  if (outcome === "nothing-found") await prisma.takeoffWallProposal.deleteMany({ where: { pageId: target.pageId, calibrationId: target.calibrationId } });
  const detected = { pageId: target.pageId, source: "DETECTED" as const, kind: "LINEAR" as const };
  const total = await prisma.takeoffMeasurement.count({ where: detected });
  if (total === 0) return { kind: "proposals-only" };
  const posted = await prisma.takeoffMeasurement.count({ where: { ...detected, postedAt: { not: null } } });
  if (posted > 0) return { kind: "posted-left-alone" };
  await prisma.takeoffMeasurement.deleteMany({ where: detected });
  if (outcome === "nothing-found") return { kind: "emptied" };
  await wallItemsForSheet({ planId: target.planId, companyId: target.companyId, jobId: target.jobId, pageNumber: target.pageNumber, userId: target.userId });
  return { kind: "replaced" };
}
