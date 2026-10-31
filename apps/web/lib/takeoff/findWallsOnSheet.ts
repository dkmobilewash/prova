import {
  type WallCandidate,
  type WallCluster,
  type StrokeSegment,
  type WallFinderOptions,
  clusterByThickness,
  wallsInTheBuilding,
  wallsNotLettering,
  wallsNotTheSheetBorder,
} from "./wallVectors";
import { gridBubbles, linesIntoBubbles } from "./gridBubbles";
import { joinAtCorners } from "./joinCorners";
import { proposedOpenings } from "./openingProposals";
import { wallsFromBothEngines } from "./wallRuns";
import { templateFromSheets, withoutTemplate } from "./sheetTemplate";
import { wallTypeTags, tagByRun } from "./wallTags";
import { defaultWallTypeFromNotes } from "./wallNotes";
import { planTextTagByRun, type PlanTextInput } from "./planTextTags";
import { scaleBarLabels, wallsNotTheScaleBar } from "./scaleBar";
import { wallsNotDuplicateCoverage } from "./duplicateCoverage";
import { curvedWalls } from "./curvedWalls";
import { wallsNotIsolatedStubs } from "./isolatedStubs";
import { wallsActuallyDrawn } from "./drawnCoverage";
import { DEFAULTS } from "./wallVectors";
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
   * Told about every candidate pairing with its feature vector, and optionally
   * asked to score one — see `WallFinderOptions`. Extraction and the trained
   * classifier both arrive through here; with neither set nothing changes.
   */
  onCandidate?: WallFinderOptions["onCandidate"];
  decide?: WallFinderOptions["decide"];
  /** The strokes were clipped to a drawing region or a view: a set the layer
   *  filter empties holds no wall, and the filter's fail-safe must not fire. */
  regionClipped?: boolean;
  /** Removes a wall the rules chose, and nothing else — see `WallFinderOptions.veto`. */
  veto?: WallFinderOptions["veto"];
  /**
   * Called with each stage's name and how long it took, when a caller wants
   * to know. Optional and unset everywhere in the product.
   *
   * ── IT EXISTS BECAUSE GUESSING WAS COSTING MORE THAN MEASURING ──
   *
   * `AUDIT.md` recorded this function at 102 seconds on a real sheet and said
   * the first thing to do was profile it, in as many words: "Everything below
   * is speculation until that exists." A hook is how the profile names a
   * stage without this file importing a timer or a logger.
   */
  onStage?: (stage: string, ms: number) => void;
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
  /**
   * The set's legend vocabulary, handed in only when `PLAN_TEXT_READ` is on.
   * Absent, the regroup block below is exactly what it was; see
   * `planTextTags.ts` for what it does when present.
   */
  planText?: PlanTextInput;
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
  /** Segments removed for being column-grid lines running into a bubble.
   *  Reported rather than silent: a sheet whose grid was mistaken for walls
   *  and a sheet with no grid both drop zero, and only this tells them apart. */
  gridDropped: number;
  /** Runs refused because nothing is drawn along them — see `drawnCoverage.ts`. */
  hatchDropped: number;
  /** Candidates removed for claiming footage another candidate already
   *  claimed. Reported for the same reason as `gridDropped`: a sheet whose
   *  dimension strings were sold as walls and a sheet with none both drop
   *  zero, and only this tells them apart. */
  duplicateDropped: number;
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
    gray: one.gray,
    fill: one.fill,
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

  // Reports nothing and costs one comparison per stage when nobody is asking.
  let stageStart = Date.now();
  const stage = (name: string) => {
    if (!input.onStage) return;
    const now = Date.now();
    input.onStage(name, now - stageStart);
    stageStart = now;
  };

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
  stage("layers");
  const onWallLayers = withoutNonWallLayers(input.segments, { emptyIsAnswer: input.regionClipped === true });
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

  // ── THE COLUMN GRID, REMOVED BEFORE THE PAIRER EVER SEES IT ──
  //
  // A grid line is two things at once: a line a wall-thickness from a real
  // wall face, and the one thing on a floor plan that ENDS IN A BUBBLE.
  // `gridBubbles.ts` was written for this — measured against a 60-page key,
  // where 1,849 ft came back in a 12.4in band matching no assembly, and the
  // offender was a 115 ft line running past the building at both ends — and
  // then nothing ever called it.
  //
  // It belongs HERE, on raw segments, rather than after pairing: a grid line
  // that has already been paired with a real wall face has corrupted that
  // wall's thickness, and no later filter can tell which of the two faces was
  // the wrong one.
  //
  // A bubble is a PAPER size (3/8in to 5/8in) because it has to hold a
  // readable character at any drawing scale. These coordinates are page-WIDTH
  // units, so one paper inch is 72 points over the sheet's own width.
  const unitsPerPaperInch = 72 / pageSize.widthPt;
  //
  // ── AND ONLY THE LINES THAT ACTUALLY TOUCH A BUBBLE ──
  //
  // `gridLineSegments` was tried here first and it is too strong for this
  // position: it extends from a bubble to every COLLINEAR segment, and
  // architects draw column grids ON WALL CENTRELINES, so a wall sharing a
  // grid's line goes with it. Measured on the bench — missed walls went from
  // 115 to 263, the holdout total from -2.3% to -6.4%, and one whole wall
  // type on A-101__revit read -100%: every D1 wall gone.
  //
  // `linesIntoBubbles` is the seed set alone — a segment with an END inside a
  // bubble. That is the property a grid line has and a wall does not, and it
  // cannot take a wall that merely lies along the same line.
  const bubbles = gridBubbles(inUnits, unitsPerPaperInch);
  stage("grid");
  const gridIndices = linesIntoBubbles(inUnits, bubbles);
  const gridDropped = gridIndices.size;
  if (gridDropped > 0) inUnits = inUnits.filter((_, i) => !gridIndices.has(i));

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
    onCandidate: input.onCandidate,
    // For the census-born features: the words, centred, and the raw strokes.
    words: textItems.map((item) => ({ str: item.str, x: (item.x + item.width / 2) / pageSize.widthPt, y: (item.y + item.height / 2) / pageSize.widthPt })),
    strokes: inUnits,
    decide: input.decide,
    veto: input.veto,
  });
  // ── THE NOISE COMES OUT BEFORE THE BUILDING IS LOOKED FOR ──
  //
  // These four filters used to run AFTER `wallsInTheBuilding`, and that order
  // is what made a run COUNT necessary. Grouping first means the title block,
  // the lettering and the sheet border are all still candidates when the
  // groups are formed — so on a sheet with no plan on it the title block can
  // be the biggest group, and the only thing standing between an estimator
  // and "the walls of this building are the title block" was `NOT_A_BOX`:
  // reject any group under ten runs.
  //
  // That count could not tell a title block from a ONE-ROOM BUILDING, because
  // both are four runs. It discarded S01 (one room), S10 and S11 (ordinary
  // small houses, thin double-line walls, perfectly axis-aligned) — the easy
  // case — while never actually asking the question it stood in for.
  //
  // Filtering first asks it directly. Lettering, the sheet border and the
  // scale bar are recognised by what they ARE, each by a rule that already
  // existed and was already justified; a title block is mostly lettering
  // against the sheet edge, so it leaves on its own. What remains is the
  // drawing, and the biggest connected group of THAT needs no minimum size.
  //
  // Measured on the fixtures: the biggest group spans 25-52% of the sheet
  // width on all seventeen vector sheets, the five that used to return
  // nothing included. There was never a size that separated them.
  // ── AND THE CURVES, WHICH THE PAIRER CANNOT ASSEMBLE ──
  //
  // The pairer owns curved strokes (see `StrokeSegment.curved`) and does pair
  // them face to face, but it pairs each 8-inch chord with the chord opposite
  // and `mergeWalls` cannot join the results: consecutive pieces of an arc
  // turn 3.2 degrees at every joint against a 2.9 degree tolerance. S07's bay
  // contributed nothing at all because of it.
  //
  // Added to the same candidate list so every filter below applies to them
  // too — a curved stroke can be lettering or a scale bar's arc as easily as
  // a straight one can. `curvedWalls.ts` has the geometry and why the mean of
  // two faces' path lengths IS the centreline arc.
  stage("both-engines");
  let curvesRefused: number | null = null;
  const curves = curvedWalls(inUnits, {
    onCount: (pieces) => input.onStage?.(`curve-pieces=${pieces}`, 0),
    onRefused: (pieces) => {
      curvesRefused = pieces;
      input.onStage?.(`curves-refused=${pieces}`, 0);
    },
    feetPerUnit,
    minThicknessFeet: DEFAULTS.minThicknessFeet,
    maxThicknessFeet: DEFAULTS.maxThicknessFeet,
  });

  stage("curves");
  const notLettering = wallsNotLettering([...everywhere, ...curves], textBoxes, feetPerUnit);
  const notBorder = wallsNotTheSheetBorder(notLettering, 1, aspect);
  // THE GRAPHIC SCALE BAR is two parallel lines a wall-thickness apart and
  // 32 ft long — a textbook wall by every measurement, and the one thing on
  // the sheet that is literally a ruler.
  const notScaleBar = wallsNotTheScaleBar(
    notBorder,
    scaleBarLabels(textItems, pageSize.widthPt),
    feetPerUnit,
  );
  // AND ONLY THEN, WHERE THE BUILDING IS. A floor plan is one connected
  // thing; whatever is left over after the filters above is either part of it
  // or is somewhere else on the sheet.
  stage("noise-filters");
  // ── AND THE THINGS STANDING INSIDE THE BUILDING THAT ARE NOT IT ──
  //
  // Before `wallsInTheBuilding` and not after, because that one joins at
  // TWENTY feet to keep a plan together across its gaps — so a bench in a
  // lobby is comfortably part of the building by its measure and survives.
  // This asks the tighter question first: does this short run touch anything
  // at all? See `isolatedStubs.ts` for the measurement on two real sheets.
  const notStubs = wallsNotIsolatedStubs(notScaleBar, feetPerUnit);
  // ── AND THE RUNS WITH NOTHING ACTUALLY DRAWN ALONG THEM ──
  //
  // Hatching, including diagonal hatching, whose ticks `oneFacePerLine` has
  // assembled into two long "faces" a plausible thickness apart. On Camp Bow
  // Wow A120 that was 29 runs and 176 ft of ±60° X patterns across an enlarged
  // restroom plan, every one of them a textbook partition by thickness.
  //
  // BEFORE `wallsInTheBuilding`, with the other noise filters, and for the
  // reason this block already gives: the X's cover the middle of the plan, so
  // they are comfortably part of the biggest connected group and grouping
  // cannot refuse them. `drawnCoverage.ts` carries the measurement, why
  // counting the lines BETWEEN the faces does not work, and why the rule is
  // deliberately blind to a run's angle.
  const notHatch = wallsActuallyDrawn(notStubs, inUnits, feetPerUnit);
  const hatchDropped = notStubs.length - notHatch.length;
  const inBuilding = wallsInTheBuilding(notHatch, feetPerUnit);
  // ── AND THEIR ENDS PUT BACK ON THE CORNERS ──
  //
  // Last, because it needs the final set: a wall can only be joined to one
  // that survived every filter, and joining to a sheet-border line or a grid
  // stub would drag an end somewhere no building is. See `joinCorners.ts` for
  // the half-thickness this recovers at every corner, and the generator's own
  // rule that it implements.
  // ── TWO WALLS CANNOT OCCUPY THE SAME FOOTAGE ──
  //
  // Last of the candidate filters, and after `wallsInTheBuilding` on purpose:
  // the thing it removes is a SECOND claim on footage another candidate has
  // already made, so every candidate that is going to survive must be present
  // for the comparison to be right. Before the corner join, because that
  // extends ends and would move the centrelines being compared.
  //
  // `duplicateCoverage.ts` has the measurements and the three discriminators
  // that do NOT work, including two that were built and reverted.
  stage("in-building");
  const noDuplicates = wallsNotDuplicateCoverage(inBuilding, scheduleIn);

  stage("duplicates");
  const joined = joinAtCorners(noDuplicates.kept, feetPerUnit);

  // ── AND THE DOORS AND WINDOWS DRAWN IN THEM ──
  //
  // AFTER every wall decision, and it changes none: each run keeps its ends,
  // its thickness and its length, and only gains a list of what is drawn in
  // its gaps. Read against the sheet's strokes as DRAWN (`input.segments`, not
  // the filtered `inUnits`): the filters above exist to keep non-walls out of
  // the pairer, and they remove exactly what this needs to see. Measured on
  // the bench, a door's TAG circle reads as a grid bubble to `gridBubbles`,
  // and `linesIntoBubbles` then drops every swing piece with an end inside it
  // — three of five pieces on the corridor doors it caught, and A-101's
  // proposed doors went from 23 of 30 to 27 when this read the drawing
  // instead. The run itself is what
  // keeps the search on a wall. See `openingProposals.ts`.
  const drawn = input.segments.map(inPageWidthUnits(pageSize.widthPt));
  const openingsByRun = proposedOpenings(joined, drawn, feetPerUnit);
  const walls = joined.map((run, index) => {
    const found = openingsByRun.get(index);
    return found ? { ...run, proposedOpenings: found } : run;
  });
  stage("openings");

  // ── WHAT THE DRAWING CALLS THESE, where it says so ──
  //
  // ONE PASS OVER THE TEXT for the tags, the scale bar and the general note:
  // the items are read once above and every reader works from them.
  stage("join-corners");
  const tags = wallTypeTags(textItems, pageSize.widthPt);
  const fromNote = defaultWallTypeFromNotes(textItems, wallTypes);

  // ONE DEFINITION OF THE PANEL, used now and again after labelling.
  //
  // ── WITH THE SET'S OWN VOCABULARY, WHEN THE SWITCH IS ON ──
  //
  // `planText` arrives only from `detectWallsForCalibration` with
  // `PLAN_TEXT_READ=1`. Then the map comes from the drawing's symbols and
  // bare codes filtered by the legend, carried along each wall; the text tags
  // above are still offered. Without it, the line below is the one that has
  // always run — `zzSwitchOff.eval.ts` holds the two outputs equal on the
  // training sheets.
  const planText = input.planText;
  const regroup = (runs: WallCandidate[]) =>
    planText === undefined
      ? wallGroups(
          clusterByThickness(runs),
          tagByRun(runs, tags, feetPerUnit, wallTypes),
          wallTypes,
          fromNote,
        )
      : wallGroups(
          clusterByThickness(runs),
          planTextTagByRun({
            segments: input.segments,
            text: input.textItems,
            widthPt: pageSize.widthPt,
            walls: runs,
            feetPerUnit,
            legendCodes: planText.legendCodes,
            textTags: tags,
            wallTypes,
          }).byRun,
          wallTypes,
          fromNote,
        );

  return {
    inUnits,
    gridDropped,
    hatchDropped,
    duplicateDropped: noDuplicates.dropped,
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
