import {
  type WallCandidate,
  type WallCluster,
  type StrokeSegment,
  clusterByThickness,
  wallsInTheBuilding,
  wallsNotLettering,
  wallsNotTheSheetBorder,
} from "./wallVectors";
import { wallsFromBothEngines } from "./wallRuns";
import { templateFromSheets, withoutTemplate } from "./sheetTemplate";
import { wallTypeTags, tagByRun } from "./wallTags";
import { defaultWallTypeFromNotes } from "./wallNotes";
import { scaleBarLabels, wallsNotTheScaleBar } from "./scaleBar";
import { wallGroups, type WallGroup } from "./wallGroups";
import { withoutNonWallLayers, type LayerDrop } from "./layerNames";
import type { MatchableWallType } from "./wallTypeMatch";

/**
 * FINDING THE WALLS ON ONE SHEET — the whole pipeline, in one place.
 *
 * ── WHY THIS FILE EXISTS, AND IT IS A DEFECT RATHER THAN TIDINESS ──
 *
 * This ran inside `TakeoffPlanViewer.tsx`'s `onFindWalls`, a React component, so
 * there was no function for anything else to call. `bench/harness.ts` said of
 * its own copy: *"`TakeoffPlanViewer.onFindWalls`, line for line, against a PDF
 * in memory… the wall pipeline's ORCHESTRATION lives inside a React component,
 * so there is no exported function to call."*
 *
 * **It was not line for line any more.** Measured before this was written, the
 * bench copy had drifted in three ways, two of them live:
 *
 *   - it **dropped `curved`** when rebuilding the stroke objects. `wallRuns.ts`
 *     filters `curved !== true` to keep arcs out of the room engine, so a
 *     dropped flag puts them back in — and the viewer's own comment predicts the
 *     result: *"a flattened arc would reach the room engine again and the lobby
 *     wall would be billed twice: 1,957 ft against a key of 1,894."*
 *   - it had **no `wallsNotTheScaleBar`**, so the graphic scale bar — two
 *     parallel lines a wall thickness apart and 32 ft long — was counted as a
 *     wall, which is the one thing on a sheet that is literally a ruler.
 *   - it had **no template pass**. Inert on the bench's single-page fixtures,
 *     because `templateFromSheets` needs `MIN_SHEETS` sheets and returns an
 *     empty set below that — but a divergence waiting for the first multi-sheet
 *     run.
 *
 * Both live drifts ADD false walls, so the bench was grading a worse pipeline
 * than the one that ships. Nobody was careless: the copy was honest when it was
 * written and the product moved underneath it. One implementation is the only
 * fix that stays fixed.
 *
 * ── PURE ──
 *
 * No pdf.js, no DOM, no database. Callers read the page — the browser from the
 * document it already has open, the server from `plan-ingest/planPdf.ts` — and
 * hand the pieces in. That is what lets this run in both places and be tested in
 * neither.
 */

/**
 * A word on the page, in the convention `planPdf.ts` stores.
 *
 * `y` IS THE BASELINE, not the top of the glyph, and the difference has bitten
 * once already. `planPdf.pageText` pushes `y: m[5]`; the viewer used to push
 * `y: m[5] - height` before handing the items on. Both are correct about their
 * own convention and a caller that mixes them puts every text box ONE GLYPH
 * HEIGHT low — silently, because nothing downstream throws: the lettering
 * filter just stops covering the lettering, and the tag matcher reaches for a
 * run that is not there.
 *
 * So the shift happens HERE, once, and no caller does it. `planPdf`'s shape is
 * the one both sides pass.
 */
export type SheetTextItem = {
  str: string;
  /** From the left edge, in points. */
  x: number;
  /** The BASELINE, in points, running down from the top of the page. */
  y: number;
  width: number;
  height: number;
};

export type SheetSize = { widthPt: number; heightPt: number };

export type FindWallsInput = {
  /** Every stroked segment on this sheet, in POINTS, as `segmentsFromOpenPage`
   *  returns them. */
  segments: readonly StrokeSegment[];
  /** Every word on this sheet, in points, baseline `y` — see `SheetTextItem`. */
  textItems: readonly SheetTextItem[];
  pageSize: SheetSize;
  /** Feet per page WIDTH unit, from the sheet's own calibration. */
  feetPerUnit: number;
  /** The company's wall types. Used three ways — see below. */
  wallTypes: readonly MatchableWallType[];
  /**
   * Other sheets of the same set, each already in ITS OWN page-width units, for
   * the template pass. Null when the caller could not read them, which is not
   * an error: the geometric filters still run and the sheet gets exactly what
   * it had before the template pass existed.
   *
   * The caller includes this sheet's own strokes among them, because that is
   * what the viewer has always done and `templateFromSheets` counts how many
   * sheets a position appears on.
   */
  sampledSheets: readonly (readonly StrokeSegment[])[] | null;
};

/**
 * Every stage, not just the answer.
 *
 * THE INTERMEDIATES ARE LOAD-BEARING FOR THE BENCH, which uses them to name
 * WHICH filter dropped a wall — `"wallsInTheBuilding: not in the biggest
 * connected group"` rather than "missing". A function returning only the final
 * walls would have destroyed the most useful diagnostic the bench has.
 */
export type FoundOnSheet = {
  /** In page-width units, after the template pass. */
  inUnits: StrokeSegment[];
  everywhere: WallCandidate[];
  inBuilding: WallCandidate[];
  notLettering: WallCandidate[];
  notBorder: WallCandidate[];
  /** What survived every filter. */
  walls: WallCandidate[];
  clusters: WallCluster[];
  groups: WallGroup[];
  /** How many strokes the set's own template accounted for, so a panel can SAY
   *  it rather than quietly returning a smaller number. */
  templateDropped: number;
  /**
   * What the LAYER filter removed, per layer, biggest first — empty on a sheet
   * with no layer information, which is every flattened plot.
   *
   * Reported for the same reason `templateDropped` is: a filter that silently
   * shrinks a number is how somebody stops believing the number. This one needs
   * it more, because it can remove a whole discipline's worth of line work and
   * an estimator looking for the ducts they drew has to be able to find out
   * where they went.
   */
  layerDropped: LayerDrop[];
  /** Re-groups a filtered run list the same way. The viewer calls it again
   *  after labelling: a second call site building groups a slightly different
   *  way is how the list somebody accepts stops matching the list they looked
   *  at. */
  regroup: (runs: WallCandidate[]) => WallGroup[];
};

/**
 * Page-width units: every stored figure is a fraction of THIS page's width, and
 * `width` is deliberately left in points — the pen is compared against other
 * pens on the same sheet, never against a distance, so scaling it would be
 * arithmetic with no meaning.
 */
export function inPageWidthUnits(over: number) {
  return (one: StrokeSegment): StrokeSegment => ({
    x1: one.x1 / over,
    y1: one.y1 / over,
    x2: one.x2 / over,
    y2: one.y2 / over,
    width: one.width,
    // CARRIED, because this rebuilds the object field by field and the flag
    // decides which engine may use the piece — see `StrokeSegment.curved`.
    // Dropped here, a flattened arc would reach the room engine again and the
    // lobby wall would be billed twice: 1,957 ft against a key of 1,894. The
    // bench's own copy dropped it, which is half of why this file exists.
    curved: one.curved,
    // CARRIED FOR THE SAME REASON, AND THIS IS THE SECOND TIME. A field added
    // to `StrokeSegment` and forgotten here vanishes with nothing thrown — the
    // `curved` bug exactly, which survived every test in the repo. Dropped,
    // the layer filter would see `undefined` on every segment, call every one
    // of them `unknown`, keep the lot, and report a change that does nothing.
    //
    // `strokeFieldsCensus.test.ts` now fails the build on the THIRD occurrence
    // rather than waiting for somebody to notice it.
    layer: one.layer,
  });
}

/**
 * A word moved from its BASELINE to its top edge, so the box grows downwards.
 *
 * ── WHY THIS IS A NAMED FUNCTION AND NOT A LINE INSIDE THE PIPELINE ──
 *
 * It was a line inside the pipeline, and a mutation proved nothing could see
 * it: dropping the shift entirely, and reversing its sign, both left every test
 * in this repo green. That is the worst shape a defect can have here, because
 * nothing throws — `wallsNotLettering` simply stops covering the lettering and
 * `wallTypeTags` reaches for a run that is not beside the tag, on a drawing
 * nobody is going to re-measure by hand.
 *
 * The two conventions are both real and both correct about themselves:
 * `planPdf.pageText` stores `m[5]`, the baseline, and every consumer here wants
 * the top edge. Naming the conversion is what lets a test hold it still.
 */
export function fromBaseline(item: SheetTextItem): SheetTextItem {
  return {
    str: item.str,
    x: item.x,
    y: item.y - item.height,
    width: item.width,
    height: item.height,
  };
}

export function findWallsOnSheet(input: FindWallsInput): FoundOnSheet {
  const { pageSize, feetPerUnit, wallTypes } = input;

  // THE SHIFT, ONCE — see `fromBaseline`, which is a named function precisely
  // so this can be tested rather than trusted.
  const textItems = input.textItems.map(fromBaseline);
  const textBoxes = textItems.map((item) => ({
    x: item.x / pageSize.widthPt,
    y: item.y / pageSize.widthPt,
    width: item.width / pageSize.widthPt,
    height: item.height / pageSize.widthPt,
  }));

  // ── WHAT THE DRAWING CALLS EACH LINE, BEFORE ANY GEOMETRY IS MEASURED ──
  //
  // First, because it is the cheapest filter and the only one that is not a
  // measurement. Everything below asks a question about a stroke's shape; this
  // asks what the person who drew it named it, and a stroke on `A-FURN` is not
  // a wall however wall-shaped it is.
  //
  // A SECOND EFFECT IS HOPED FOR HERE AND IS NOT YET PROVEN, said plainly
  // because the comment claiming it outright was written before it was tested.
  // `inAHatchSeries` scans EVERY segment for a third parallel line beside a
  // candidate pair and rejects the pair when it finds one, and the holdout's
  // own diagnosis names `S-GRID` — a column gridline — as the most common
  // cause of missed footage across its 20 plans. A gridline dropped here is a
  // gridline that test never sees, so the mechanism is real.
  //
  // What is NOT established is that it recovers footage. Probe P16 tried two
  // constructions, including a line at exactly the whole-number pitch the
  // series test requires, and both arms returned the same number: on inputs
  // that simple the geometric filters already cope. P16 therefore asserts only
  // what it can see — the line never reaches the pairer — and says so.
  const onWallLayers = withoutNonWallLayers(input.segments);
  const allInUnits = onWallLayers.kept.map(inPageWidthUnits(pageSize.widthPt));

  // ── THE SET'S OWN TEMPLATE, READ FROM OTHER SHEETS ──
  //
  // The frame, the title block and the logo are the only geometry at the SAME
  // page position on every sheet of a set. A wall is not. `sheetTemplate.ts`
  // carries the reasoning and the fail-safe: too few sheets read and it filters
  // nothing, because "cannot tell" must not mean "drop it".
  let inUnits = allInUnits;
  let templateDropped = 0;
  if (input.sampledSheets !== null) {
    // THE SAMPLES GET THE SAME FILTER, or the comparison is between two
    // different populations: the title block would be absent from this sheet
    // (dropped as `G-ANNO-TTLB`) and present in every sample, so the template
    // would still "find" it and then have nothing here to remove. Harmless in
    // that direction, and the reverse — a layer kept here and dropped there —
    // would quietly weaken the frame filter. Filtering both keeps the pass
    // asking the question it was written to ask.
    const template = templateFromSheets(
      input.sampledSheets.map((sheet) => withoutNonWallLayers(sheet).kept),
    );
    if (template.size > 0) {
      const kept = withoutTemplate(allInUnits, template);
      templateDropped = allInUnits.length - kept.length;
      inUnits = kept;
    }
  }

  // BOTH ENGINES, MERGED. Pairing asks "are these two lines a wall" and needs no
  // room to close; the room engine asks which enclosed regions are thin AND
  // separate two different spaces. Opposite blind spots, so neither wins alone.
  //
  // AND THE PARTITION SCHEDULE GOES IN WITH IT. The thicknesses of the types
  // this company builds are what let the finder tell an assembly from a span
  // across two of them: 1-1/2in furring on an 8in block wall is 8 and 1-1/2,
  // never one wall of 9-1/2in, because 9-1/2in is on no schedule.
  const scheduleIn = wallTypes
    .map((type) => type.thicknessIn)
    .filter((inches): inches is number => inches !== null);
  const aspect = pageSize.heightPt / pageSize.widthPt;
  const everywhere = wallsFromBothEngines(inUnits, 1, aspect, {
    feetPerPoint: feetPerUnit,
    knownThicknessesIn: scheduleIn,
  });
  // ONLY THE ONES IN THE BUILDING — without this the title block, the notes
  // column, the sheet border and any detail drawn above the plan all come back.
  const inBuilding = wallsInTheBuilding(everywhere, feetPerUnit);
  // AND NOT THE LETTERING. A stroked glyph is two parallel lines and the pairer
  // takes it.
  const notLettering = wallsNotLettering(inBuilding, textBoxes, feetPerUnit);
  // AND NOT THE SHEET'S OWN BORDER, which a real set offered as a 114ft wall.
  const notBorder = wallsNotTheSheetBorder(notLettering, 1, aspect);
  // AND NOT THE GRAPHIC SCALE BAR, which is two parallel lines a wall-thickness
  // apart and 32 ft long — a textbook wall by every measurement, and the one
  // thing on the sheet that is literally a ruler. The bench's copy had no such
  // filter, which is the other half of why this file exists.
  const walls = wallsNotTheScaleBar(
    notBorder,
    scaleBarLabels(textItems, pageSize.widthPt),
    feetPerUnit,
  );

  // ── WHAT THE DRAWING CALLS THESE, where it says so ──
  //
  // ONE PASS OVER THE TEXT for the tags, the scale bar and the general note:
  // the items are read once above and every reader works from them.
  const tags = wallTypeTags(textItems, pageSize.widthPt);
  const fromNote = defaultWallTypeFromNotes(textItems, wallTypes);

  // ONE DEFINITION OF THE PANEL, used now and again after labelling.
  const regroup = (runs: WallCandidate[]) =>
    wallGroups(
      clusterByThickness(runs),
      tagByRun(runs, tags, feetPerUnit, wallTypes),
      wallTypes,
      fromNote,
    );

  return {
    inUnits,
    everywhere,
    inBuilding,
    notLettering,
    notBorder,
    walls,
    clusters: clusterByThickness(walls),
    groups: regroup(walls),
    templateDropped,
    layerDropped: onWallLayers.dropped,
    regroup,
  };
}
