import { candidatesFromSheet, type Candidate } from "./answerKeyReview";
import { findWallsOnSheet, inPageWidthUnits, type FoundOnSheet } from "./findWallsOnSheet";
import {
  drawingCount,
  excludedViews,
  keptPlanViews,
  mergeViewWalls,
  sheetDrawings,
  textBlockBoxes,
  viewBoxes,
  viewRegions,
  wallsPerView,
  type ExcludedView,
  type ViewWalls,
} from "./sheetViews";
import { drawingRegions, segmentsInRegions } from "./planRegion";
import { classifySingleLines, worthOffering } from "./singleLines";
import { viewKind } from "./viewKind";
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
  /**
   * The lines the classifier withheld, with their geometry.
   *
   * ── COUNTS CANNOT ANSWER WHETHER THE TRIAGE IS WORTH KEEPING ──
   *
   * The panel needs counts by reason, and that is all this returned. But
   * "152 set aside on Murray" says nothing about whether those were junk or
   * walls — and the miss analysis showed reviewers tracing walls by hand that
   * the finder had proposed and the classifier had withheld. Answering that
   * needs the geometry, so it comes out here and the panel keeps ignoring it.
   */
  setAsideLines: {
    kind: string;
    why: string;
    lengthFeet: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }[];
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

export function offeredCandidates(
  sheet: DetectedSheet,
  /** Also offer the HATCH-classed set-asides, for a reviewer judging them. */
  offerAll = false,
  /** See `ClassifyInput.hatchPitchRule`: on for labelling, off for customers. */
  hatchPitchRule = false,
): OfferedResult {
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
    hatchPitchRule,
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
        // ── THE OVERRIDE IS HATCH-CLASSED LINES, NOT EVERYTHING ──
        //
        // Measured on the training sheets, five of the six set-aside reasons
        // withheld 27,934 ft across 165 lines without a single foot of
        // confirmed wall. Offering those spends a reviewer's attention on
        // what is already known to be junk. `in-a-hatch` is the one reason
        // that has ever hidden a wall, so it is the one worth a verdict.
        .filter((one) => worthOffering(one.kind) || (offerAll && one.kind === "in-a-hatch"))
        .map((one) => ({
          line: one.line,
          lengthFeet: one.lengthFeet,
          kind: one.kind,
          why: one.why,
        })),
    }),
    setAside: [...aside.values()].sort((a, b) => b.n - a.n),
    setAsideLines: classified
      .filter((one) => !worthOffering(one.kind))
      .map((one) => ({
        kind: one.kind,
        why: one.why,
        lengthFeet: one.lengthFeet,
        x1: one.line.x1,
        y1: one.line.y1,
        x2: one.line.x2,
        y2: one.line.y2,
      })),
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
  /**
   * The model's veto, passed straight through to `findWallsOnSheet`.
   *
   * It belongs here rather than at the call site because a score taken on
   * "the app's candidate list" has to run the veto where the app would run
   * it — inside detection, before the triage sees anything. Scoring the
   * veto against a list built without it compares two different pipelines.
   */
  veto?: Parameters<typeof findWallsOnSheet>[0]["veto"];
  /** Every pairing the finder considers, for answer-key mode. Forwarded to
   *  every finder call this makes, whichever branch the sheet takes. */
  onCandidate?: Parameters<typeof findWallsOnSheet>[0]["onCandidate"];
  /** The title size ratio `viewTitles` uses; an eval's knob, left alone by the app. */
  titleSizeRatio?: number;
  /**
   * The company's wall-type codes plus the legend's, for symbol tagging.
   *
   * `detectWallsForCalibration` has always passed this to `findWallsOnSheet`
   * directly. There was no field for it here, so the server could not move
   * onto this pipeline without losing tagging silently — the same shape as
   * the veto's own scar in `wallsPerView`, which is why it is declared in
   * both places rather than spread in.
   */
  planText?: Parameters<typeof findWallsOnSheet>[0]["planText"];
};

export type SheetDetectResult = {
  found: FoundOnSheet;
  /**
   * Set when the sheet's drawings were found but NONE could be measured and
   * none was set aside for a reason an estimator could check, so the whole
   * sheet was measured as one drawing instead — see `wholeSheetFallback`.
   */
  wholeSheet?: { why: string } | null;
  planBoxes: { from: number; to: number; fromY: number; toY: number }[] | null;
  /** How many DRAWINGS the sheet was split into — under two means measured whole. */
  views: number;
  /** The views whose walls are in `found`, biggest first — one per level named. */
  kept: { name: string; scaleName: string | null; lengthFeet: number }[];
  /** `kept[0]`'s name, for callers that still want one. */
  primaryName: string | null;
  /** Measured plan views NOT in `found` — a floor drawn twice, an enlarged plan. */
  others: ViewWalls[];
  /** Drawings and text blocks left out, each with the reason, for the caution. */
  leftOut: ExcludedView[];
};

/**
 * ── THE ONE PIPELINE, FOR THE VIEWER AND THE EVALS ALIKE ──
 *
 * The viewer used to carry its own copy of this and `detectForSheet` was an
 * extraction of it that omitted one call (`viewsInRegions`), which is the
 * whole of "Murray 160 against the app's 32". A copy drifts; a call cannot.
 * So the viewer calls this now, and what it shows — the kept views, the
 * others, the left-out — comes back from here rather than being rebuilt.
 *
 * What runs, in order (each step measured in `realplan/zzViewDetection.eval.ts`
 * and recorded in NOTES.md, 2026-10-22):
 *
 *   1. `sheetDrawings`: captions with a scale ∪ titles lettered big and
 *      ruled, placed from the sheet's gutters with a caption below its
 *      drawing and a heading above its words; notes, legends and schedules
 *      are TEXT BLOCKS that own only their region.
 *   2. Under two DRAWINGS: the sheet is measured whole, less the text blocks,
 *      by `drawingRegions` — the busiest region and what is comparable.
 *   3. Two or more: every plan view at its own scale (`wallsPerView`), one
 *      kept per LEVEL named (`keptPlanViews`), joined (`mergeViewWalls`).
 */
/**
 * Whether to measure the whole sheet because its drawings were found but
 * none could be understood. Fires ONLY when every drawing was found and
 * none measured, and none of them was set aside for a NAMED reason — notes,
 * a legend, a schedule, an elevation, a section, a detail. A drawing the
 * caption reader could not place ("check it") or could not scale is not a
 * named reason: it is the shape OCR noise takes. Pure, so it has a test.
 */
export function wholeSheetFallback(
  views: readonly { name: string; textBlock?: boolean }[],
  measured: readonly unknown[],
): { why: string } | null {
  if (views.length === 0 || measured.length > 0) return null;
  const named = views.some((view) => view.textBlock === true || viewKind(view.name).kind === "not-a-plan");
  if (named) return null;
  return {
    why:
      "the drawings' captions could not be read well enough to tell them apart, so the whole sheet was measured as one drawing — check each group against the sheet",
  };
}

export function detectForSheet(input: SheetDetectInput): SheetDetectResult {
  const views = sheetDrawings({ items: input.textItems, segments: input.segments, pageSize: input.pageSize, sizeRatio: input.titleSizeRatio });
  const base = {
    segments: [...input.segments],
    textItems: [...input.textItems],
    pageSize: input.pageSize,
    feetPerUnit: input.feetPerUnit,
    wallTypes: [...(input.wallTypes ?? [])],
    sampledSheets: input.sampledSheets ?? null,
    veto: input.veto,
    onCandidate: input.onCandidate,
    planText: input.planText,
  };
  const leftOut = excludedViews(views);

  if (drawingCount(views) < 2) {
    // ── A ONE-DRAWING SHEET STILL HAS A TITLE BLOCK, AND IT MEASURED IT ──
    //
    // `viewRegions` separates the title block, the notes and the legend from
    // the drawing; `planRegion.ts` keeps the BUSIEST region and whatever is
    // comparable to it, which is what cannot reintroduce the S05/S07 scar. A
    // text block whose heading was read is taken out first — Baker A101's
    // notes column measured as 242 ft of wall before that.
    const blocks = textBlockBoxes(views);
    const regions = viewRegions(base.segments, input.pageSize).filter(
      (r) =>
        !blocks.some(
          (b) => r.from >= b.from - 1e-9 && r.to <= b.to + 1e-9 && r.fromY >= b.fromY - 1e-9 && r.toY <= b.toY + 1e-9,
        ),
    );
    const drawing = drawingRegions(regions, base.segments, input.pageSize.widthPt);
    const onTheDrawing = segmentsInRegions(base.segments, drawing, input.pageSize.widthPt);
    return {
      found: findWallsOnSheet({ ...base, segments: onTheDrawing }),
      wholeSheet: null,
      planBoxes: drawing.length > 0 ? [...drawing] : null,
      views: drawingCount(views),
      kept: [],
      primaryName: null,
      others: [],
      leftOut,
    };
  }

  const measured = wallsPerView({ ...base, views });
  const { kept, others } = keptPlanViews(measured);
  // ── DRAWINGS FOUND, NONE UNDERSTOOD: MEASURE THE SHEET AND SAY SO ──
  //
  // On a SCAN the captions come from OCR, and OCR noise reads as captions
  // the view detector splits the sheet by and then cannot classify or
  // scale — so nothing is kept, nothing is excluded for a reason, and the
  // sheet measured nothing (Bunkie A100 at 300 dpi: 0 of 470 ft). A vector
  // sheet never lands here: its captions name what they are, and a sheet of
  // eight elevations stays at zero because every one of them is set aside
  // for a reason the estimator can check (Baker A201).
  const fallback = wholeSheetFallback(views, measured);
  if (fallback !== null) {
    return {
      found: findWallsOnSheet(base),
      wholeSheet: fallback,
      planBoxes: null,
      views: drawingCount(views),
      kept: [],
      primaryName: null,
      others: [],
      leftOut: [{ name: "every drawing on this sheet", reason: fallback.why }],
    };
  }
  return {
    wholeSheet: null,
    // ── A SHEET WITH NO PLAN ON IT MEASURES NOTHING ──
    //
    // The real pipeline on no geometry rather than a hand-built empty result,
    // so every field of `FoundOnSheet` comes out consistent. Falling back to
    // the whole sheet is the worst available answer for a page of eight
    // interior elevations.
    found: mergeViewWalls(kept) ?? findWallsOnSheet({ ...base, segments: [], textItems: [] }),
    planBoxes: measured.flatMap((one) => viewBoxes(one.view)),
    views: drawingCount(views),
    kept: kept.map((k) => ({ name: k.view.name, scaleName: k.view.scaleName, lengthFeet: k.lengthFeet })),
    primaryName: kept[0]?.view.name ?? null,
    others,
    leftOut,
  };
}
