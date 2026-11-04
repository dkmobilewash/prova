import { demoRuns } from "./demoWalls";
import { existingWallSet } from "./existingWallSet";
import { findWallsOnSheet } from "./findWallsOnSheet";
import { pairDemoWithNewPlan, type SheetForPairing } from "./pairDemoPlans";
import { FEW_WALLS_SHARE, MIN_VOTES, onPriorPlan, type PriorLine } from "./planCompare";
import { alignViews, type Line } from "./viewAlign";
import { oneFacePerLine, type StrokeSegment, type WallCandidate } from "./wallVectors";

/**
 * ── WHICH DEMOLITION PLAN A NEW PLAN IS COMPARED WITH, AND WHAT IT SHOWS ──
 *
 * Plan comparison (`planCompare.ts`): a wall on the new plan that the same
 * level's demolition plan also draws, and does not remove, is existing to
 * remain. Measured on round 11's training keys (2026-11-04): 3,168 ft of junk
 * set aside for 84 ft of real wall, no building worse than 43 ft; held-out
 * renovation posted vs key +182% → +90%. Behind `Company.planCompareOn`.
 *
 * Two questions, kept apart because they are answered in different places:
 *
 *   WHICH PAGE  `autoPairs` from the sheet numbers and titles the inventory
 *               stored (AD1.0 → A3.1, D100 → A100). Derived, never stored; a
 *               person's change or removal is the only thing saved, and
 *               `pairingFor` lets it win.
 *   WHAT LINES  `priorPlanFor`, from the two pages' own drawings, once both
 *               are loaded. The same layout is a requirement, not an
 *               assumption: if the demolition plan does not line up with the
 *               new plan by at least `MIN_VOTES` walls, nothing is set aside
 *               and the sheet says why.
 */

export type PairChoice = { priorPage: number | null; choice: "user" | "none" | null };
export type Pairing = { demoPage: number; source: "auto" | "user"; basis: string };

/** New page → its demolition plan, from sheet numbers and titles alone. Only a pair the pairer is sure of. */
export function autoPairs(sheets: readonly SheetForPairing[]): Map<number, { demoPage: number; basis: string }> {
  const out = new Map<number, { demoPage: number; basis: string }>();
  for (const pair of pairDemoWithNewPlan(sheets)) {
    if (pair.newPage === null || pair.primary === false || out.has(pair.newPage)) continue;
    out.set(pair.newPage, { demoPage: pair.demoPage, basis: pair.basis });
  }
  return out;
}

/** A person's choice wins: a page they picked, or "none" for a pair they removed. */
export function pairingFor(newPage: number, auto: ReadonlyMap<number, { demoPage: number; basis: string }>, saved: PairChoice | null): Pairing | null {
  if (saved?.choice === "none") return null;
  if (saved?.choice === "user" && saved.priorPage !== null && saved.priorPage !== newPage) return { demoPage: saved.priorPage, source: "user", basis: "chosen" };
  const a = auto.get(newPage);
  return a === undefined ? null : { demoPage: a.demoPage, source: "auto", basis: a.basis };
}

/** A page's long faces, page-width units: what the layout check votes with when the demolition plan pairs too few walls. */
export function longFaces(segments: readonly StrokeSegment[], widthPt: number, feetPerUnit: number): Line[] {
  return oneFacePerLine([...segments], feetPerUnit / widthPt)
    .map((f) => ({ x1: f.x1 / widthPt, y1: f.y1 / widthPt, x2: f.x2 / widthPt, y2: f.y2 / widthPt }))
    .filter((f) => Math.hypot(f.x2 - f.x1, f.y2 - f.y1) * feetPerUnit >= 3);
}

type Page = { segments: readonly StrokeSegment[]; textItems: readonly { str: string; x: number; y: number; width: number; height: number }[]; widthPt: number; heightPt: number };
export type PriorPlan = { lines: PriorLine[]; votes: number; walls: "walls" | "faces" } | { lines: null; why: string };

/**
 * The demolition plan's standing walls, moved onto the new sheet.
 *
 * The demolition page is read at the new sheet's scale, adjusted for paper
 * size. Its walls minus the ones it removes are the building that stays; where
 * the finder pairs too few walls there, its raw faces stand in, each wall
 * then needing both faces drawn (`onPriorPlan`).
 */
export function priorPlanFor(input: { demo: Page; newPage: { segments: readonly StrokeSegment[]; widthPt: number }; newRuns: readonly WallCandidate[]; feetPerUnit: number }): PriorPlan {
  const { demo, newPage, newRuns, feetPerUnit } = input;
  if (demo.segments.length < 100) return { lines: null, why: "the demolition plan has no drawing to compare with" };
  const fpDemo = (feetPerUnit * demo.widthPt) / newPage.widthPt;
  const remove = demoRuns(demo.segments, demo.widthPt, fpDemo, demo.textItems);
  const removed = (l: Line) =>
    remove.some(
      (r) =>
        onPriorPlan({ ...r, thicknessFeet: 0.5 }, [{ ...l, thicknessFeet: 0.5 }], feetPerUnit) ||
        onPriorPlan({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, thicknessFeet: r.thicknessIn / 12 }, [{ ...r, thicknessFeet: r.thicknessIn / 12 }], feetPerUnit),
    );
  const paired = findWallsOnSheet({ segments: demo.segments, textItems: demo.textItems, pageSize: { widthPt: demo.widthPt, heightPt: demo.heightPt }, feetPerUnit: fpDemo, wallTypes: [], sampledSheets: null }).walls;
  const remain = paired.filter((w) => !removed(w));
  const liveFeet = newRuns.reduce((n, w) => n + w.lengthFeet, 0);
  const few = remain.reduce((n, w) => n + w.lengthFeet, 0) < FEW_WALLS_SHARE * liveFeet;
  const faces = longFaces(demo.segments, demo.widthPt, fpDemo);
  const set = existingWallSet({ level: null, remove, remain, newPlan: newRuns, feetPerUnit });
  const shift = !few && set.shift !== null ? set.shift : alignViews(longFaces(newPage.segments, newPage.widthPt, feetPerUnit), faces, feetPerUnit);
  if (shift === null || shift.votes < MIN_VOTES) return { lines: null, why: `the demolition plan does not line up with this sheet (${shift?.votes ?? 0} of ${MIN_VOTES} walls agree), so nothing is compared` };
  const lines: PriorLine[] = few ? faces.filter((f) => !removed(f)) : remain.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet }));
  return { lines: lines.map((p) => ({ ...p, x1: p.x1 + shift.dx, y1: p.y1 + shift.dy, x2: p.x2 + shift.dx, y2: p.y2 + shift.dy })), votes: shift.votes, walls: few ? "faces" : "walls" };
}
