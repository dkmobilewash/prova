import { candidatesFromSheet, type Candidate } from "./answerKeyReview";
import { findWallsOnSheet, inPageWidthUnits, type FoundOnSheet } from "./findWallsOnSheet";
import { primaryView, sheetViews, wallsPerView } from "./sheetViews";
import { classifySingleLines, worthOffering } from "./singleLines";
import { oneFacePerLine, wallFromPair, type StrokeSegment, type WallCandidate } from "./wallVectors";

/**
 * ── THE ONE LIST A REVIEWER IS ACTUALLY SHOWN ──
 *
 * The finder returns candidates; the panel shows FEWER. Everything between
 * the two used to live inside `TakeoffPlanViewer`, which meant no eval could
 * reach it — so every measurement in `realplan/` was of the finder's raw
 * output while the app displayed something else.
 *
 * That gap was not small. Candidates the app showed against what the evals
 * built, on the nine traced training sheets:
 *
 *     Murray A101      app  32   eval 160
 *     Crosslines A100  app 154   eval 263
 *     Bunkie A104      app  15   eval  36
 *
 * And it mattered beyond the numbers: the miss analysis concluded that 1,826
 * ft of traced wall sat on candidates "nobody judged", when in fact those
 * rows were never in the list. Same cause, two wrong conclusions.
 *
 * ── WHAT REDUCES THE LIST, IN ORDER ──
 *
 *  1. PAIRED candidates are kept only where the sheet was MEASURED — inside
 *     the plan boxes. This is the whole of Murray's 160 to 32: that sheet
 *     carries five times more paired line work outside its floor plan than
 *     inside it.
 *
 *  2. SINGLE lines — a face with no partner — are offered only when they are
 *     long enough to matter (12 ft), on a plan, not already covered by a
 *     paired wall, and genuinely unpairable.
 *
 *  3. Those are then CLASSIFIED, and only what the classifier could not name
 *     is offered. On A102 that is 162 hatch lines out of 168. `offerAll`
 *     overrides it, and what was set aside is always reported rather than
 *     dropped in silence.
 *
 * The app and the evals both call this now. A measurement of the app's own
 * list is what a customer sees; the finder's raw output is a different
 * question, and both are legitimate as long as nobody confuses them.
 */
export type DetectedSheet = {
  /** The finder's paired candidates, in page-width units. */
  walls: readonly WallCandidate[];
  /** The sheet's strokes, in POINTS — divided by `widthPt` here. */
  segments: readonly StrokeSegment[];
  widthPt: number;
  feetPerUnit: number;
  /** Where the sheet was measured. Null means the whole page counts. */
  planBoxes: readonly { from: number; to: number; fromY: number; toY: number }[] | null;
};

export type OfferedResult = {
  /** Exactly what the panel lists. */
  candidates: Candidate[];
  /** What the classifier withheld, by its own reason, for the panel to say. */
  setAside: { kind: string; why: string; n: number }[];
  /** For a measurement: the paired candidates dropped for being off-plan. */
  offPlanPaired: number;
};

/** A single line must be at least this long to be worth a reviewer's time. */
export const SHORTEST_SINGLE_FEET = 12;

/** Is this part of the sheet one that was measured? */
function onAPlan(sheet: DetectedSheet, x1: number, y1: number, x2: number, y2: number): boolean {
  if (sheet.planBoxes === null) return true;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return sheet.planBoxes.some(
    (box) => mx >= box.from && mx < box.to && my >= box.fromY && my < box.toY,
  );
}

export function offeredCandidates(sheet: DetectedSheet, offerAll = false): OfferedResult {
  const faces = oneFacePerLine(sheet.segments, sheet.feetPerUnit / sheet.widthPt).map(
    inPageWidthUnits(sheet.widthPt),
  );

  const covered = (f: StrokeSegment) => {
    const mx = (f.x1 + f.x2) / 2;
    const my = (f.y1 + f.y2) / 2;
    return sheet.walls.some((w) => {
      const dx = w.x2 - w.x1;
      const dy = w.y2 - w.y1;
      const len2 = dx * dx + dy * dy;
      const t =
        len2 === 0 ? 0 : Math.max(0, Math.min(1, ((mx - w.x1) * dx + (my - w.y1) * dy) / len2));
      return Math.hypot(mx - (w.x1 + t * dx), my - (w.y1 + t * dy)) * sheet.feetPerUnit <= 1.5;
    });
  };

  const pairOptions = { feetPerPoint: sheet.feetPerUnit };
  const unclaimed = faces.filter(
    (f) =>
      Math.hypot(f.x2 - f.x1, f.y2 - f.y1) * sheet.feetPerUnit >= SHORTEST_SINGLE_FEET &&
      onAPlan(sheet, f.x1, f.y1, f.x2, f.y2) &&
      !covered(f) &&
      !faces.some((other) => other !== f && wallFromPair(f, other, pairOptions) !== null),
  );

  const classified = classifySingleLines({
    unclaimed,
    faces,
    segments: sheet.segments.map(inPageWidthUnits(sheet.widthPt)),
    walls: sheet.walls,
    feetPerUnit: sheet.feetPerUnit,
  });

  // Counted by reason even when `offerAll` is on, so the sentence the panel
  // shows is about the drawing rather than about the filter's current setting.
  const aside = new Map<string, { kind: string; why: string; n: number }>();
  for (const one of classified) {
    if (worthOffering(one.kind)) continue;
    const at = aside.get(one.kind) ?? { kind: one.kind, why: one.why, n: 0 };
    at.n += 1;
    aside.set(one.kind, at);
  }

  const onPlan = sheet.walls.filter((w) => onAPlan(sheet, w.x1, w.y1, w.x2, w.y2));

  return {
    candidates: candidatesFromSheet({
      walls: onPlan.map((w) => ({
        x1: w.x1,
        y1: w.y1,
        x2: w.x2,
        y2: w.y2,
        lengthFeet: w.lengthFeet,
        thicknessFeet: w.thicknessFeet,
      })),
      singles: classified
        .filter((one) => offerAll || worthOffering(one.kind))
        .map((one) => ({
          line: one.line,
          lengthFeet: one.lengthFeet,
          kind: one.kind,
          why: one.why,
        })),
    }),
    setAside: [...aside.values()].sort((a, b) => b.n - a.n),
    offPlanPaired: sheet.walls.length - onPlan.length,
  };
}

/**
 * ── WHAT THE APP DETECTS, WHICH IS NOT WHAT THE WHOLE SHEET CONTAINS ──
 *
 * The step before `offeredCandidates`, and the larger half of the answer to
 * "why does the app show 32 candidates on Murray A101 where an eval sees
 * 160".
 *
 * It is not a filter. On a sheet carrying two or more captioned views the app
 * MEASURES EACH VIEW AT ITS OWN SCALE (`wallsPerView`), picks the one that
 * prices the job (`primaryView`), and then uses THAT VIEW'S detection as the
 * result — a different run, not a subset. The plan boxes it returns are every
 * measured plan's own region, which is what `offeredCandidates` keeps paired
 * candidates inside.
 *
 * A sheet with fewer than two views is measured whole, which is why most
 * sheets show no difference at all.
 *
 * ── AND IT CORRECTS SOMETHING I REPORTED EARLIER ──
 *
 * I measured a "plan-footprint filter" from scratch, found it unshippable,
 * and said the blocker was that `sheetViews` reports one view on sixteen of
 * eighteen sheets. The app was already doing this — on the six sheets that DO
 * have two or more views, including the two where my own junk analysis
 * concentrated its worst numbers. The filter existed and shipped; I measured
 * around it.
 *
 * So a junk figure taken from whole-sheet detection — 6,573 ft "outside the
 * building" — is substantially about parts of the page the app never asks a
 * reviewer about. That number describes the finder, not the product.
 */
export type SheetDetectInput = {
  segments: readonly StrokeSegment[];
  textItems: readonly { str: string; x: number; y: number; width: number; height: number }[];
  pageSize: { widthPt: number; heightPt: number };
  feetPerUnit: number;
  wallTypes?: Parameters<typeof findWallsOnSheet>[0]["wallTypes"];
  sampledSheets?: StrokeSegment[][] | null;
};

export type SheetDetectResult = {
  found: FoundOnSheet;
  planBoxes: { from: number; to: number; fromY: number; toY: number }[] | null;
  /** How many captioned views the sheet has — under two means measured whole. */
  views: number;
  /** The view that was measured, where one was picked. */
  primaryName: string | null;
};

export function detectForSheet(input: SheetDetectInput): SheetDetectResult {
  const views = sheetViews(input.textItems, input.pageSize.widthPt);
  const base = {
    segments: [...input.segments],
    textItems: [...input.textItems],
    pageSize: input.pageSize,
    feetPerUnit: input.feetPerUnit,
    wallTypes: [...(input.wallTypes ?? [])],
    sampledSheets: input.sampledSheets ?? null,
  };

  if (views.length < 2) {
    return { found: findWallsOnSheet(base), planBoxes: null, views: views.length, primaryName: null };
  }

  const measured = wallsPerView({ ...base, views });
  const picked = primaryView(measured);
  const planBoxes = measured.flatMap(
    (one) =>
      one.view.boxes ?? [
        { from: one.view.from, to: one.view.to, fromY: one.view.fromY, toY: one.view.toY },
      ],
  );
  return {
    // ── A SHEET WITH NO PLAN ON IT MEASURES NOTHING ──
    //
    // The real pipeline on no geometry rather than a hand-built empty result,
    // so every field of `FoundOnSheet` comes out consistent. The viewer's own
    // comment explains why falling back to the whole sheet is the worst
    // available answer for a page of eight interior elevations.
    found:
      picked.primary?.found ??
      findWallsOnSheet({ ...base, segments: [], textItems: [] }),
    planBoxes,
    views: views.length,
    primaryName: picked.primary?.view.name ?? null,
  };
}
