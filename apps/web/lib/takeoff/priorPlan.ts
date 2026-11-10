import { demoRuns } from "./demoWalls";
import { existingWallSet } from "./existingWallSet";
import { findWallsOnSheet } from "./findWallsOnSheet";
import { FEW_WALLS_SHARE, MIN_VOTES, onPriorPlan, type PriorLine } from "./planCompare";
import { alignViews, longFaces, type Line } from "./viewAlign";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

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
 *   WHICH PAGE  `autoPairs` (`priorPlanLoad.ts`, server only — the pairer
 *               reaches the database) from the sheet numbers and titles the inventory
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

export { longFaces } from "./viewAlign";

type Page = { segments: readonly StrokeSegment[]; textItems: readonly { str: string; x: number; y: number; width: number; height: number }[]; widthPt: number; heightPt: number };
export type PriorPlan = { lines: PriorLine[]; votes: number; walls: "walls" | "faces"; shift?: { dx: number; dy: number } } | { lines: null; why: string };

/** A frame-aligned pair compares only lines at least this long (a dash is shorter) and asks this much of both faces. */
export const SOLID_FACE_FEET = 6;
export const FRAME_SHARE = 0.8;
/** Two border lines are the same when they sit within this of each other, page-width units. */
const FRAME_SLACK = 0.003;

/**
 * Whether two pages are the same sheet of paper in the same frame: the same
 * width, and every long border or title-block line on one has its twin on the
 * other — at least two of them, so a blank page cannot pass.
 */
export function samePaper(a: { segments: readonly StrokeSegment[]; widthPt: number }, b: { segments: readonly StrokeSegment[]; widthPt: number }): boolean {
  if (Math.abs(a.widthPt - b.widthPt) > 1) return false;
  const long = (p: typeof a) =>
    p.segments
      .map((g) => ({ x1: g.x1 / p.widthPt, y1: g.y1 / p.widthPt, x2: g.x2 / p.widthPt, y2: g.y2 / p.widthPt }))
      // Frame lengths, not wall lengths: a border runs most of the page — 0.85 of its width, or
      // 0.6 of it upright (a sheet is ~0.7 as tall as wide) — and no plan's wall does at plan scale.
      .filter((l) => (Math.abs(l.y2 - l.y1) < 1e-3 && Math.abs(l.x2 - l.x1) >= 0.85) || (Math.abs(l.x2 - l.x1) < 1e-3 && Math.abs(l.y2 - l.y1) >= 0.6));
  const la = long(a), lb = long(b);
  if (la.length < 2) return false;
  const twin = (l: Line, others: readonly Line[]) =>
    others.some((o) => [[l.x1, o.x1], [l.y1, o.y1], [l.x2, o.x2], [l.y2, o.y2]].every(([p, q]) => Math.abs(p! - q!) <= FRAME_SLACK) ||
      [[l.x1, o.x2], [l.y1, o.y2], [l.x2, o.x1], [l.y2, o.y1]].every(([p, q]) => Math.abs(p! - q!) <= FRAME_SLACK));
  return la.every((l) => twin(l, lb));
}

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
  if (shift === null || shift.votes < MIN_VOTES) {
    // ── THE SAME SHEET OF PAPER: ALIGNED BY ITS FRAME ──
    // Green Bay A3.1/A3.2 and McAllen A3.2 print their demolition plans on the
    // same paper, in the same frame, with the building in the same place —
    // every method put the shift at about 0 ft — but the finder pairs too few
    // demolition walls for the wall vote to say so. Where the frame lines up,
    // the frame is the alignment. What it compares against is narrower than a
    // wall-aligned pair: only SOLID demolition lines (a dash is a wall to be
    // removed, where new walls get rebuilt — Green Bay grid 9), never one on a
    // removed wall, and a run needs both faces drawn along FRAME_SHARE of it.
    if (samePaper(demo, newPage)) {
      const W = demo.widthPt, minLen = SOLID_FACE_FEET / fpDemo;
      const solid: PriorLine[] = demo.segments
        .map((g) => ({ x1: g.x1 / W, y1: g.y1 / W, x2: g.x2 / W, y2: g.y2 / W }))
        .filter((l) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) >= minLen && !removed(l))
        .map((l) => ({ ...l, minShare: FRAME_SHARE }));
      if (solid.length > 0) return { lines: solid, votes: shift?.votes ?? 0, walls: "faces", shift: { dx: 0, dy: 0 } };
    }
    return { lines: null, why: `the demolition plan does not line up with this sheet (${shift?.votes ?? 0} of ${MIN_VOTES} walls agree), so nothing is compared` };
  }
  // ── THE DEMOLITION PLAN'S FACES RIDE ALONG WITH ITS PAIRED WALLS ──
  // The finder pairs only some of a demolition plan's walls, and a wall it
  // pairs at another thickness fails the band; both are still drawn there as
  // faces. Crosslines' and E Street's comparisons left 713 ft of existing wall
  // offered that way. `onPriorPlan` takes raw faces only with BOTH of a wall's
  // faces drawn, so one line beside a new wall still claims nothing.
  const standingFaces = faces.filter((f) => !removed(f));
  const lines: PriorLine[] = few ? standingFaces : [...remain.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, thicknessFeet: w.thicknessFeet })), ...standingFaces];
  return { lines: lines.map((p) => ({ ...p, x1: p.x1 + shift.dx, y1: p.y1 + shift.dy, x2: p.x2 + shift.dx, y2: p.y2 + shift.dy })), votes: shift.votes, walls: few ? "faces" : "walls", shift: { dx: shift.dx, dy: shift.dy } };
}
