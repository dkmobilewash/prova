import { findWallsOnSheet, type FoundOnSheet, type SheetTextItem } from "./findWallsOnSheet";
import { printedScalesAt } from "./printedScales";
import type { StrokeSegment, WallCandidate } from "./wallVectors";
import type { MatchableWallType } from "./wallTypeMatch";

/**
 * ── ONE SHEET, MORE THAN ONE DRAWING, MORE THAN ONE SCALE ──
 *
 * A plan with an enlarged detail beside it is two drawings at two scales, and
 * every length this app reports used to come from ONE of them, because a sheet
 * had one calibration. That is wrong by the ratio between them — on S15, by
 * double — and it is silent.
 *
 * ── WHAT IT WAS GETTING RIGHT, AND WHY THAT WAS LUCK ──
 *
 * S15 reads correctly today and nothing here knew why. `wallsInTheBuilding`
 * keeps the biggest connected GROUP, and the enlarged bath is smaller, so it
 * was dropped for being small rather than for being drawn at another scale.
 * That inverts the moment the detail is the bigger drawing, and then the whole
 * sheet is measured at the detail's scale with nothing to say so.
 *
 * ── WHY A VIEW HAS TO BE CLIPPED AND NOT JUST RE-SCALED ──
 *
 * Measured, because the obvious approach fails in a way that looks like it
 * works. Running the whole sheet again at the detail's 1/2in:
 *
 * | what was run | result |
 * | --- | --- |
 * | whole sheet at 1/4in (the sheet's vote) | 8 runs 167ft, plus two 1-run scraps |
 * | whole sheet at 1/2in | ONE group, 87ft, spanning x 14.8..77.7 |
 * | **plan band only, at 1/4in** | **8 runs, 167ft** |
 * | **detail band only, at 1/2in** | **3 runs, 28ft** |
 * | detail band only, at 1/4in (the wrong one) | 1 run, 6ft |
 *
 * The second row is the trap: `SAME_BUILDING_FEET` is in FEET, so changing the
 * scale changes how much of the page counts as one building, and at 1/2in the
 * plan and the detail merge into a single "building" straddling the sheet. So
 * the region comes first and the scale second, never the other way round.
 *
 * The last row is the defect itself, in one line: the same geometry read at the
 * wrong scale returns 6 ft where 28 ft is drawn.
 */

/** A drawing on a sheet, and the scale captioned under it. */
export type SheetView = {
  /** The caption above the scale — "FLOOR PLAN", "ENLARGED BATH PLAN". */
  name: string;
  /** What the caption says, or null where it says something no scale can be
   *  read from — `NTS`, `AS NOTED`. */
  scaleName: string | null;
  /** Null for a view that CANNOT be measured. It still owns its region, which
   *  is the whole reason it is returned rather than dropped. */
  feetPerInch: number | null;
  /** Where the scale caption sits, in page-WIDTH units (x/widthPt). */
  captionX: number;
  captionY: number;
  /** The part of the page this view's drawing occupies, in page-width units.
   *  Derived from the sheet's own GUTTERS — see `viewRegions`. */
  from: number;
  to: number;
  /** The same region on the other axis. A sheet that stacks its drawings is
   *  separated here and not by `from`/`to`. */
  fromY: number;
  toY: number;
};

/**
 * ── HOW MUCH EMPTY PAPER SEPARATES TWO DRAWINGS ──
 *
 * In PAPER INCHES, for the reason `gridBubbles.ts` measures a bubble that way:
 * a gutter is a drafting decision about the sheet, not about the building, so
 * it is the same width whatever the drawings are scaled at.
 *
 * Measured on the two multi-view sheets that exist. A-401's restroom plan ends
 * at 1006pt and its stair plan begins at 1100pt — a 94pt gutter, 1.3in. S15's
 * is far wider. Half an inch is comfortably below both and far above anything
 * INSIDE a drawing, because a gutter has to be empty across the FULL height of
 * the sheet: a room's interior is void, but the walls above and below it cover
 * the same x, so a room never produces one.
 */
const GUTTER_INCHES = 0.5;

/**
 * A line long enough to be the sheet's frame rather than anything drawn in a
 * view, as a fraction of the page. The border and the title block rules span
 * the whole sheet and would otherwise bridge every gutter, leaving a page with
 * no gaps at all and one region.
 */
const FRAME_SPAN = 0.8;

/**
 * HOW FAR ABOVE ITS SCALE A VIEW'S NAME SITS, in page-width units.
 *
 * Measured on the fixtures rather than chosen: a caption and its scale are one
 * line apart — 0.5% of page width on S15, 0.9% on S02. 2% is four times the
 * larger of those and still far short of anything else on the page.
 */
const NAME_ABOVE = 0.02;

/** How far a name may sit to the side of its scale and still belong to it. */
const NAME_BESIDE = 0.02;

/**
 * ── WHAT MAKES A CAPTION A VIEW'S AND NOT THE TITLE BLOCK'S ──
 *
 * EVERY sheet prints a scale in its title block, and on a single-view sheet it
 * is the same scale the view is captioned with. So the count of scales cannot
 * separate them, and neither can position alone.
 *
 * The rule that looked obvious and is WRONG: "a view caption has text directly
 * above it". Measured on S15, the title block reads
 *
 *     DATE: 10/15/2026          (92.7%, 60.9%)
 *     SCALE: 1/4" = 1'-0"       (92.7%, 61.4%)
 *
 * — the SAME 0.5% gap as a real view caption. Something is above both.
 *
 * What is actually true is the drafting convention: a view is captioned with
 * WHAT IT IS. `FLOOR PLAN`, `ENLARGED BATH PLAN`, `WALL SECTION`. A title block
 * carries a date, a sheet number and a project name, and none of those names a
 * view. So the discriminator is the word, and `DATE:` fails it.
 *
 * The sheet's own title is the one thing that could fool this — S15's is
 * "BUNGALOW - PLAN AND ENLARGED", which does contain PLAN. It sits 56% of the
 * page away from any scale, so `NAME_ABOVE` excludes it by a factor of 28.
 */
const VIEW_NAME = /\b(PLAN|ELEVATION|SECTION|DETAIL|SCHEDULE|DIAGRAM|VIEW|LAYOUT)\b/i;

/**
 * The drawings on a sheet, left to right, each with the scale captioned under
 * it. Empty when nothing on the page is captioned as a view, which is the
 * ordinary case for a sheet the title block speaks for.
 *
 * ── THE BAND, AND THE LAYOUT IT ASSUMES ──
 *
 * A view owns the x band from its own caption to the next caption's. Measured
 * on the fixtures: captions are left-aligned at a margin and the drawing sits
 * to the RIGHT of its caption — S15's plan is captioned at x 5.0% and drawn
 * across 14.8..39.8%, its detail captioned at 52.6% and drawn across
 * 69.7..77.3%. So the boundary at 52.6% separates them and neither drawing is
 * cut.
 *
 * **This assumes views laid out LEFT TO RIGHT.** A sheet stacking one drawing
 * above another needs the y axis as well and is not handled — such a sheet
 * yields bands that overlap in y, every view claims the full height, and the
 * upper drawing lands in whichever band its x falls in. That is a real bound
 * and not a hypothetical: it is the layout a detail sheet usually uses. The
 * caller's guard against it is the same as for everything else here — a view
 * whose band holds no walls reports none, and the primary view is chosen by
 * FOOTAGE rather than by position.
 */
export function sheetViews(
  items: readonly { str: string; x: number; y: number }[],
  widthPt: number,
): SheetView[] {
  if (!(widthPt > 0)) return [];
  const scales = printedScalesAt(items);
  const named: SheetView[] = [];

  // ── FOUND BY NAME, THEN THE SCALE READ FROM THE LINE BELOW ──
  //
  // This ran the other way first — every readable scale, then a name above it —
  // and A-401 showed what that misses. It carries a `HEAD OF WALL DETAIL`
  // captioned `SCALE: NTS`, and NTS is not a scale, so no caption was found and
  // the detail's region was absorbed into the drawing beside it. A wall detail
  // is a cross-section drawn large: parallel lines a wall-thickness apart, for
  // its whole height. Measured as wall at the neighbour's scale it added
  // hundreds of feet that are not a building.
  //
  // A view is a NAME with a scale under it, and "a scale I cannot read" is a
  // different answer from "no caption here". The first owns its region and is
  // never measured; the second does not exist.
  for (const item of items) {
    if (!VIEW_NAME.test(item.str)) continue;
    const nx = item.x / widthPt;
    const ny = item.y / widthPt;

    // A READABLE scale directly under this name, if there is one.
    let scale: { name: string; feetPerInch: number } | null = null;
    let scaleY = 0;
    for (const found of scales) {
      const gap = found.y / widthPt - ny;
      if (gap <= 0 || gap > NAME_ABOVE) continue;
      if (Math.abs(found.x / widthPt - nx) > NAME_BESIDE) continue;
      if (scale === null || gap < scaleY) {
        scale = { name: found.name, feetPerInch: found.feetPerInch };
        scaleY = gap;
      }
    }

    // Or a caption that says there is no scale. `SCALE:` is what a drafter
    // writes either way, so this finds the line and then fails to read it,
    // which is exactly the state being recorded.
    let unreadable = false;
    if (scale === null) {
      for (const other of items) {
        if (other === item) continue;
        const gap = other.y / widthPt - ny;
        if (gap <= 0 || gap > NAME_ABOVE) continue;
        if (Math.abs(other.x / widthPt - nx) > NAME_BESIDE) continue;
        if (/\bSCALE\b/i.test(other.str)) unreadable = true;
      }
    }
    if (scale === null && !unreadable) continue;

    named.push({
      name: item.str.trim(),
      scaleName: scale?.name ?? null,
      feetPerInch: scale?.feetPerInch ?? null,
      captionX: nx,
      captionY: ny,
      // Replaced by `viewsInRegions`. The whole page until then, so a caller
      // that never asks for regions measures the sheet exactly as it did.
      from: 0,
      to: 1,
      fromY: 0,
      toY: Number.POSITIVE_INFINITY,
    });
  }

  named.sort((a, b) => a.captionX - b.captionX);
  return named;
}

/** Where geometry actually sits on one axis, as merged intervals. */
function occupied(spans: readonly [number, number][]): [number, number][] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [sorted[0]];
  for (const span of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else out.push([...span]);
  }
  return out;
}

/**
 * ── THE GUTTERS, WHICH IS WHAT ACTUALLY SEPARATES TWO DRAWINGS ──
 *
 * The first version of this banded the page from each caption's x to the next
 * caption's x, and it was wrong in a way only a second sheet could show. It
 * rests on the caption sitting at the LEFT MARGIN of its drawing, which is
 * what the 20-sheet fixture set does. A-401 does not:
 *
 * | | caption x | its drawing spans |
 * | --- | --- | --- |
 * | ENLARGED RESTROOM PLAN | 200 | **160**..1006 |
 * | ENLARGED STAIR PLAN | 1150 | **1100**..1856 |
 *
 * The caption sits INSIDE its own drawing on that sheet, so a band beginning
 * at the caption throws away the left edge of both — quietly, as missing wall.
 *
 * So the page is cut where there is NOTHING, not where a caption happens to
 * be. A gutter is empty across the whole of the other axis, which is why a
 * room's interior cannot make one: the walls above and below it occupy the
 * same x. And it works on BOTH axes with no extra rule, which is what makes a
 * stacked sheet separate — the same emptiness, read down the page instead of
 * across it.
 *
 * The frame is excluded first or there are no gutters at all: a border rule
 * runs the full width of the sheet and bridges every gap on the page.
 */
export function viewRegions(
  segments: readonly StrokeSegment[],
  pageSize: { widthPt: number; heightPt: number },
): { from: number; to: number; fromY: number; toY: number }[] {
  const W = pageSize.widthPt;
  if (!(W > 0) || segments.length === 0) return [];
  const frame = FRAME_SPAN * W;
  const inView = segments.filter(
    (one) => Math.abs(one.x2 - one.x1) < frame && Math.abs(one.y2 - one.y1) < frame,
  );
  if (inView.length === 0) return [];

  const gutter = GUTTER_INCHES * 72;
  const cut = (pick: (one: StrokeSegment) => [number, number]): number[] => {
    const runs = occupied(inView.map(pick));
    const edges: number[] = [];
    for (let i = 0; i < runs.length - 1; i += 1) {
      if (runs[i + 1][0] - runs[i][1] >= gutter) edges.push((runs[i][1] + runs[i + 1][0]) / 2);
    }
    return edges;
  };

  const xEdges = cut((one) => [Math.min(one.x1, one.x2), Math.max(one.x1, one.x2)]);
  const yEdges = cut((one) => [Math.min(one.y1, one.y2), Math.max(one.y1, one.y2)]);
  const xs = [0, ...xEdges, W];
  const ys = [0, ...yEdges, pageSize.heightPt];

  const out: { from: number; to: number; fromY: number; toY: number }[] = [];
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < ys.length - 1; j += 1) {
      // A CELL WITH NOTHING IN IT IS NOT A VIEW. Cutting on both axes makes a
      // grid, and a sheet with two drawings diagonally placed leaves two of
      // the four cells empty.
      const has = inView.some((one) => {
        const mx = (one.x1 + one.x2) / 2;
        const my = (one.y1 + one.y2) / 2;
        return mx >= xs[i] && mx < xs[i + 1] && my >= ys[j] && my < ys[j + 1];
      });
      if (has) out.push({ from: xs[i] / W, to: xs[i + 1] / W, fromY: ys[j] / W, toY: ys[j + 1] / W });
    }
  }
  return out;
}

/**
 * Give each caption the part of the page its drawing occupies.
 *
 * ── EVERY REGION PICKS A CAPTION, NOT EVERY CAPTION A REGION ──
 *
 * The first version ran the other way and broke two sheets that had worked.
 * S05 and S07 went to ZERO FEET, because a gutter is not only found between
 * drawings: a plan's DIMENSION COLUMN sits to its left with empty paper
 * between, and that gap is empty across the full height of the sheet exactly
 * like a real gutter is. So those sheets split into a narrow strip holding the
 * dimensions and a wide one holding the building — and the caption, which sits
 * at the left margin, chose the strip. The building was then outside the only
 * region anybody measured.
 *
 * Reversing it fixes that without needing to tell the two kinds of gap apart,
 * which is the point: a strip with no caption of its own is not a view, so it
 * joins whichever caption is nearest, and a view's extent is the UNION of
 * everything assigned to it. The dimension strip rejoins its plan because
 * there is no other caption for it to go to, and on a sheet that really does
 * carry two drawings each one keeps its own.
 *
 * A UNION BOX rather than a list of regions, because the clip downstream is a
 * range test and a box is what it can use. The cost is that two regions
 * assigned to one caption also claim what lies between them — which is empty
 * paper, or it would not have been a gutter.
 */
export function viewsInRegions(
  captions: readonly SheetView[],
  regions: readonly { from: number; to: number; fromY: number; toY: number }[],
): SheetView[] {
  if (captions.length === 0) return [];
  if (regions.length === 0) return [...captions];

  const mine = captions.map(() => [] as typeof regions[number][]);
  for (const region of regions) {
    let at = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < captions.length; i += 1) {
      const c = captions[i];
      // Distance from the caption to the region's box: zero when it is inside,
      // which is where A-401 puts both of its captions.
      const dx = Math.max(region.from - c.captionX, 0, c.captionX - region.to);
      const dy = Math.max(region.fromY - c.captionY, 0, c.captionY - region.toY);
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        at = i;
      }
    }
    mine[at].push(region);
  }

  return captions.map((caption, i) => {
    const got = mine[i];
    if (got.length === 0) return caption;
    return {
      ...caption,
      from: Math.min(...got.map((r) => r.from)),
      to: Math.max(...got.map((r) => r.to)),
      fromY: Math.min(...got.map((r) => r.fromY)),
      toY: Math.max(...got.map((r) => r.toY)),
    };
  });
}

/**
 * Replace one view's captioned scale with the scale the DIMENSIONS voted for.
 *
 * ── A CAPTION IS THE WEAKER EVIDENCE, AND THIS REPO ALREADY SAYS SO ──
 *
 * `pageInventory.ts` puts it plainly: a reading off a dimension printed on the
 * drawing can be CHECKED against the drawing, and one off a title block cannot.
 * So the printed scale is a fallback there and never a first choice — and a
 * view caption is a printed scale.
 *
 * S11 is the fixture that proves it matters. Its caption says 1/8in and its own
 * dimensions say 1/4in, deliberately — "the sheet disagrees with itself" — and
 * following the caption reports 141 ft where following the dimensions reports
 * 154 ft. One of those is 13 ft of somebody's bid.
 *
 * ── WHY IT IS ONE VIEW AND NOT THE SHEET ──
 *
 * The vote rests on a specific dimension LINE, and `ScaleCandidate` carries
 * that line's position. A line sits inside one drawing, so it says nothing
 * about the drawing beside it — an enlarged detail is at a different scale by
 * definition, and applying the plan's measured scale to it would reintroduce
 * exactly the defect this file exists to fix.
 *
 * So the measured scale replaces the caption for the view it was measured IN,
 * and every other view keeps its own caption, which is the only evidence it has.
 */
export function withDimensionScale(
  views: readonly SheetView[],
  measured: { feetPerInch: number; scaleName: string; atX: number; atY?: number },
): SheetView[] {
  return views.map((view) => {
    const inX = measured.atX >= view.from && measured.atX < view.to;
    // The y test only applies once a caller has given one — a sheet split on
    // the x axis alone must keep behaving exactly as it did.
    const inY =
      measured.atY === undefined || (measured.atY >= view.fromY && measured.atY < view.toY);
    return inX && inY
      ? { ...view, feetPerInch: measured.feetPerInch, scaleName: measured.scaleName }
      : view;
  });
}

/** One view's walls, measured at that view's own scale. */
export type ViewWalls = {
  view: SheetView;
  found: FoundOnSheet;
  walls: WallCandidate[];
  lengthFeet: number;
};

/**
 * Every view's walls, each measured at its own scale.
 *
 * ── A SEGMENT BELONGS TO THE BAND ITS MIDPOINT IS IN ──
 *
 * Not its start, and not "any part of it": a dimension line running between two
 * drawings would then be claimed by both, and a wall clipped at a band edge
 * would be measured twice at two different scales, which is the exact failure
 * this function exists to end. One segment, one view, one scale.
 *
 * ── THE CAPTIONS ARE USED AS A RATIO, NOT AS AN ABSOLUTE ──
 *
 * This is the whole of why the function takes `feetPerUnit` rather than reading
 * every scale off the sheet. The app already has a calibration it trusts for
 * this sheet — voted from the drawing's own dimensions, or set by a person
 * clicking a known distance — and a caption is the weaker evidence, which S11
 * proves in one number: its caption says 1/8in, its dimensions say 1/4in, and
 * believing the caption costs 13 ft.
 *
 * But the RATIO between two captions survives a caption being wrong, because
 * both are lettered by the same drafter about the same sheet. So:
 *
 *   - the view holding the most wall is the one the calibration is about, and
 *     it keeps `feetPerUnit` exactly;
 *   - every other view is measured at `feetPerUnit x (its caption / that
 *     view's caption)`.
 *
 * On S15 that is 1/2 over 1/4, so the enlarged bath is measured at half the
 * plan's feet per unit — and it comes back 28 ft, which is what measuring it
 * directly at 1/2in gives. A sheet whose captions are both wrong by the same
 * factor still reports the detail correctly relative to the plan, which no
 * absolute reading of the captions can do.
 */
export function wallsPerView(input: {
  segments: readonly StrokeSegment[];
  textItems: readonly SheetTextItem[];
  pageSize: { widthPt: number; heightPt: number };
  views: readonly SheetView[];
  wallTypes: readonly MatchableWallType[];
  /** What the app already trusts for this sheet, in feet per page-width unit. */
  feetPerUnit: number;
  /** Carried through so a view keeps the set's own frame filter. Clipping to a
   *  band does not move any coordinate, so the template still lines up. */
  sampledSheets?: StrokeSegment[][] | null;
}): ViewWalls[] {
  const bands = input.views
    .map((view) => ({
      view,
      segments: input.segments.filter((one) => {
        const mx = (one.x1 + one.x2) / 2 / input.pageSize.widthPt;
        const my = (one.y1 + one.y2) / 2 / input.pageSize.widthPt;
        return mx >= view.from && mx < view.to && my >= view.fromY && my < view.toY;
      }),
    }))
    // A VIEW WITH NO READABLE SCALE IS DROPPED HERE AND NOT EARLIER. By this
    // point `viewsInRegions` has already given it its region, so the geometry
    // inside it belongs to nobody and is measured by nobody — which is the
    // only honest answer for a drawing captioned NTS.
    .filter((band) => band.segments.length > 0 && band.view.feetPerInch !== null);
  if (bands.length === 0) return [];

  const measure = (band: (typeof bands)[number], feetPerUnit: number): ViewWalls => {
    const found = findWallsOnSheet({
      segments: band.segments as StrokeSegment[],
      textItems: input.textItems,
      pageSize: input.pageSize,
      feetPerUnit,
      wallTypes: input.wallTypes,
      sampledSheets: input.sampledSheets ?? null,
    });
    return {
      view: band.view,
      found,
      walls: found.walls,
      lengthFeet: found.walls.reduce((n, w) => n + w.lengthFeet, 0),
    };
  };

  // PASS ONE, every band at the sheet's own calibration, to find which band the
  // calibration is ABOUT. Measuring a detail at the plan's scale under-reports
  // it, which is this file's own table — so the biggest here is the plan by a
  // wider margin than it really is, and that only makes the choice safer.
  const first = bands.map((band) => measure(band, input.feetPerUnit));
  let bestAt = 0;
  for (let i = 1; i < first.length; i += 1) {
    if (first[i].lengthFeet > first[bestAt].lengthFeet) bestAt = i;
  }
  const anchor = first[bestAt].view.feetPerInch ?? 0;

  // PASS TWO, the others at their captioned ratio to it. A caption that cannot
  // be read as a scale never reaches here — `printedScalesAt` only emits
  // standard ones — so the ratio is always between two real numbers.
  return first.map((already, i) => {
    const mine = bands[i].view.feetPerInch ?? 0;
    if (i === bestAt || !(anchor > 0) || !(mine > 0)) return already;
    const ratio = mine / anchor;
    if (ratio === 1) return already;
    return measure(bands[i], input.feetPerUnit * ratio);
  });
}

/** A drawing that was NOT measured, and the reason in words. */
export type ExcludedView = { name: string; reason: string };

/**
 * The drawings left out of the quantities, each with why.
 *
 * ── NOTHING IS EXCLUDED SILENTLY. DIEGO'S RULE, 2026-10-16 ──
 *
 * `wallsPerView` drops a view with no readable scale, which is right — there
 * is no honest way to measure NTS. It used to drop it INVISIBLY, so a sheet
 * with three drawings reported two and said nothing about the third. An
 * estimator cannot check an omission nobody mentioned, and "the app quietly
 * decided for me" is the failure `sheetSuitability.ts` opens by refusing.
 *
 * So every excluded view comes back named, with the reason, for the caution to
 * print. The reason is specific — "not to scale" rather than "skipped" —
 * because an estimator can act on the first and can only worry about the
 * second.
 */
export function excludedViews(views: readonly SheetView[]): ExcludedView[] {
  return views
    .filter((view) => view.feetPerInch === null)
    .map((view) => ({
      name: view.name,
      reason: "not to scale, not measured",
    }));
}

/**
 * The view a takeoff should QUOTE, and the ones it should only mention.
 *
 * ── BIGGEST BY FOOTAGE, AND NOT BY SCALE OR POSITION ──
 *
 * The temptation is "the smallest scale is the overall plan". That is usually
 * true and it is not a rule: a sheet can carry two plans at one scale, and a
 * key plan is small-scale and is not the thing to bid. Footage is what the
 * estimator is buying, so footage decides.
 *
 * ── AND THE OTHERS ARE NOT ADDED, WHICH IS THE PRODUCT RULE ──
 *
 * An ENLARGED view is the same construction drawn larger. Adding its walls to
 * the plan's would bid that bathroom twice, which is the same mistake
 * `sheetSuitability` exists to stop on a mechanical sheet. So the other views
 * are reported WITH their own footage and their own scale, for a person to
 * decide, and nothing is summed across them here.
 */
export function primaryView(measured: readonly ViewWalls[]): {
  primary: ViewWalls | null;
  others: ViewWalls[];
} {
  if (measured.length === 0) return { primary: null, others: [] };
  const byFootage = [...measured].sort((a, b) => b.lengthFeet - a.lengthFeet);
  return { primary: byFootage[0], others: byFootage.slice(1) };
}
