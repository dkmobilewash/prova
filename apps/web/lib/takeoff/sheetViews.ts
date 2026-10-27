import { findWallsOnSheet, type FoundOnSheet, type SheetTextItem } from "./findWallsOnSheet";
import { printedScalesAt } from "./printedScales";
import { takeoffRank } from "./sheetSuitability";
import { isPlanView, viewKind } from "./viewKind";
import { isLevelPlan, planLevel, viewClass, viewTitles } from "./viewTitles";

export { isLevelPlan, planLevel } from "./viewTitles";
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
  /**
   * The parts of the page this view actually owns, where `viewsInRegions` has
   * run. `from`/`to`/`fromY`/`toY` are their bounding box, which is NOT the
   * same thing: a view owning a dimension strip down the left of the sheet and
   * a slice at the top has a bounding box covering what is stacked beneath it.
   * Anything deciding which geometry to MEASURE must use this.
   */
  boxes?: { from: number; to: number; fromY: number; toY: number }[];
  /** How the drawing was found: by a caption with a scale, or by its title's lettering. */
  foundBy?: "caption" | "title";
  /** A heading over notes, a legend or a table: owns only the region it sits in and is never measured. */
  textBlock?: boolean;
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

/**
 * How close two captions must be, in page-width units, to be on the same row
 * or in the same column when a region is shared out between them.
 *
 * The same 0.02 as `NAME_ABOVE`, and for the same reason: it is one line of
 * lettering on a sheet. Two captions in A120's right-hand column sit at 0.323
 * and 0.325, which is one column to any drafter, and cutting between them
 * makes a 0.002-wide slice that belongs to nobody.
 */
const CAPTION_SAME_LINE = 0.02;

/**
 * How far a name may sit to the side of its scale and still belong to it.
 *
 * ── IT WAS 0.02, AND EVERY REAL VIEW MISSED BY 0.0002 ──
 *
 * Measured on two Camp Bow Wow sheets, because the finder reported SIX views
 * on A140 and gave not one of them a scale while a scale was plainly printed
 * on the page. For every real view on both sheets, the caption sits at the
 * same offset from its name:
 *
 *     dx = +0.0202   dy = +0.0060       (page-width units)
 *
 * `NAME_ABOVE` of 0.02 covers the dy with room to spare. The dx cleared the
 * old window by two ten-thousandths, on all six views of A140 and on A120's
 * `RESTROOM - ENLARGED PLAN`, so every one of them was dropped.
 *
 * It is not noise and not a tolerance question — it is a LAYOUT. A drafter
 * writes the caption as a block:
 *
 *     1   PLAN DETAIL AT PEMB FRAME
 *         SCALE: 1" = 1'-0"
 *
 * The scale line is INDENTED under the name, past the bubble number: 52.4pt
 * on a 2592pt sheet. The old window allowed 52.0. Tuning it to 0.0203 would
 * fit this one template and break on the next, so the number here is the
 * indent a caption block can plausibly carry rather than the one measured.
 *
 * ── AND WHY IT IS STILL SMALL ──
 *
 * On A140 the views sit at x = 0.161, 0.355, 0.565, 0.699 — about 0.19 apart.
 * A window of 0.04 is a fifth of that, so a caption still cannot be stolen by
 * the view beside it, which is the failure this constant exists to prevent.
 */
const NAME_BESIDE = 0.04;

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
/*
 * ── AND THE ABBREVIATIONS, WHICH COST A WHOLE SHEET ──
 *
 * Added 2026-10-17. This pattern knew `ELEVATION` and not `ELEV.`, and Camp Bow
 * Wow A120 captions all eight of its interior elevations `RR 105 - EAST ELEV.`.
 * So the sheet produced ONE view — the enlarged plan — and `TakeoffPlanViewer`
 * only splits a sheet with two or more, which means the plan's region grew to
 * the whole page and the elevations, the accessories schedule and the floor
 * hatching were all measured as wall.
 *
 * The abbreviation is not a quirk of one drafter: a caption has a drawing's
 * width to fit in and a title block has a whole line, so a caption is where
 * shortening happens. `ELEV` cannot match ELEVATOR (no word boundary before the
 * R), so an elevator lobby plan still reads as a plan.
 *
 * FINDING a view and deciding WHAT KIND it is are deliberately two steps. This
 * pattern is deliberately greedy — a view that is found and then named as an
 * elevation owns its region and is excluded by name, which is what stops its
 * geometry being adopted by the plan beside it. A view that is never found owns
 * nothing, and that is the failure above.
 */
const VIEW_NAME =
  /\b(PLAN|ELEVATION|ELEV\.?|SECTION|SECT\.?|DETAIL|DET\.?|SCHEDULE|SCHED\.?|DIAGRAM|VIEW|LAYOUT|RCP)\b/i;

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

  // ── A REGION HOLDING SEVERAL CAPTIONS IS SHARED OUT, NOT AWARDED ──
  //
  // Added 2026-10-17, and it is the other half of the A120 failure. A gutter is
  // half a paper inch of empty paper across the full height of the sheet, and a
  // sheet that STACKS its drawings in packed rows has none between the rows:
  // A120's nine views produced four regions, every one of them spanning the
  // whole page height. One of those regions held the enlarged plan and two
  // interior elevations, and whichever caption happened to be first in the
  // array took all three drawings.
  //
  // So where a region contains more than one caption, it is cut between them —
  // on the axis in which they are most spread out, at the midpoints between
  // neighbours. That is the same reasoning `viewRegions` uses (cut where the
  // drawings are separated) applied where there is no empty paper to find it
  // by, and it needs no new constant.
  //
  // THE ORPHAN RULE IS UNTOUCHED, because it is a scar: a region with NO
  // caption of its own still joins the nearest one. A plan's dimension column
  // sits in its own gutter-separated strip with no caption, and S05 and S07
  // went to ZERO FEET when such a strip was left out. Only a region that
  // genuinely holds two or more captions is divided.
  const shared: typeof regions[number][] = [];
  for (const region of regions) {
    const inside = captions.filter(
      (c) =>
        c.captionX >= region.from &&
        c.captionX < region.to &&
        c.captionY >= region.fromY &&
        c.captionY < region.toY,
    );
    if (inside.length < 2) {
      shared.push(region);
      continue;
    }
    // BOTH AXES, as a grid, for the same reason `viewRegions` cuts both: a
    // sheet lays its drawings out in rows AND columns, and A120's own region
    // holds five captions in three rows and two columns. Cutting only the axis
    // they are most spread on was tried first and leaves a drawing with no
    // region at all — three of A120's elevations came back with an empty box,
    // because both captions in a row-slice were equidistant from it and the
    // first one took the slice.
    const cutsAlong = (values: readonly number[], lo: number, hi: number) => {
      // NEAR-EQUAL COORDINATES ARE ONE LINE. Two captions in the same column
      // sit at 0.323 and 0.325 — the same column to any drafter, and a cut
      // between them would be a 0.002-wide slice belonging to nobody.
      const sorted = [...values].sort((a, b) => a - b);
      const columns: number[] = [];
      for (const value of sorted) {
        if (columns.length === 0 || value - columns[columns.length - 1] > CAPTION_SAME_LINE) {
          columns.push(value);
        }
      }
      const cuts: number[] = [];
      for (let i = 0; i < columns.length - 1; i += 1) cuts.push((columns[i] + columns[i + 1]) / 2);
      return [lo, ...cuts, hi];
    };
    const xEdges = cutsAlong(inside.map((c) => c.captionX), region.from, region.to);
    const yEdges = cutsAlong(inside.map((c) => c.captionY), region.fromY, region.toY);
    for (let i = 0; i < xEdges.length - 1; i += 1) {
      for (let j = 0; j < yEdges.length - 1; j += 1) {
        shared.push({
          from: xEdges[i],
          to: xEdges[i + 1],
          fromY: yEdges[j],
          toY: yEdges[j + 1],
        });
      }
    }
  }

  const mine = captions.map(() => [] as typeof regions[number][]);
  for (const region of shared) {
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
    // ── A CAPTION THAT WON NOTHING MEASURES NOTHING ──
    //
    // It used to keep the `from: 0, to: 1, fromY: 0, toY: Infinity` it arrives
    // with, which is THE WHOLE SHEET — so on a sheet where two captions sat in
    // one region, the loser was handed every stroke on the page and measured
    // it at its own caption's scale. An empty box is the honest answer: this
    // drawing was found, it owns no geometry, and `excludedViews` names it.
    if (got.length === 0) {
      return { ...caption, from: 0, to: 0, fromY: 0, toY: 0, boxes: [] };
    }
    return {
      ...caption,
      // ── THE BOXES ARE THE TRUTH; THE RANGE IS THEIR BOUNDING BOX ──
      //
      // This function used to return the bounding box alone, and the docstring
      // defended it: two regions assigned to one caption "also claim what lies
      // between them — which is empty paper, or it would not have been a
      // gutter". That was sound while every region came FROM a gutter. It
      // stopped being true the moment a region could be split between captions
      // without one: on A120 the enlarged plan owns a full-height dimension
      // strip down the left AND its own slice at the top, and the bounding box
      // of those two swallows the two interior elevations stacked below it.
      //
      // So the regions are kept as a list and `wallsPerView` tests them
      // individually. The range stays for every consumer that draws a view's
      // extent, where a bounding box is what it wants anyway.
      boxes: got.map((r) => ({ from: r.from, to: r.to, fromY: r.fromY, toY: r.toY })),
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

/**
 * The parts of the page a view owns, as boxes.
 *
 * ── ONE DEFINITION, BECAUSE TWO COST 96 FEET ──
 *
 * A view's `from`/`to`/`fromY`/`toY` are the BOUNDING BOX of what it owns, and
 * on a sheet whose drawings are packed without gutters that is not the same
 * thing: A120's enlarged plan owns a dimension strip down the left of the page
 * and a slice across the top, and the box around those two covers the two
 * interior elevations stacked underneath.
 *
 * `wallsPerView` was taught to test the boxes; `realSheets.eval.ts` has its own
 * per-view loop and was still testing the range, so the same sheet measured
 * 121 ft in the app and 217 ft in the measurement meant to grade the app. One
 * rule in two places is one rule and a copy that drifted — which is the
 * failure CLAUDE.md records this repo paying for twice.
 *
 * So both ask this.
 */
export function viewBoxes(view: SheetView): { from: number; to: number; fromY: number; toY: number }[] {
  return view.boxes ?? [{ from: view.from, to: view.to, fromY: view.fromY, toY: view.toY }];
}

/** Is a point, in page-width units, inside what this view owns? */
export function insideView(view: SheetView, mx: number, my: number): boolean {
  return viewBoxes(view).some(
    (box) => mx >= box.from && mx < box.to && my >= box.fromY && my < box.toY,
  );
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
  /** Reported for every pairing the finder considers, in every view. Used by
   *  answer-key mode to save a sheet as training data. */
  onCandidate?: (features: number[], wall: WallCandidate, i: number, j: number) => void;
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
  /**
   * ── THE MODEL'S VETO, WHICH THIS FUNCTION DROPPED IN SILENCE ──
   *
   * There was no field for it here, so a caller spreading a prepared options
   * object (`{ ...base, views }`) handed the veto in and TypeScript said
   * nothing: excess-property checking applies to object LITERALS, not to a
   * spread variable. The veto fell on the floor and the sheet was measured by
   * the rules alone.
   *
   * The only symptom was a score that did not move. Two of the seven held-out
   * sheets are multi-view, and both reported byte-identical missing and extra
   * feet in the rules arm and the model arm — a model being scored on sheets
   * it had never been applied to, which is this repo's most expensive
   * recurring shape wearing a type signature.
   */
  veto?: Parameters<typeof findWallsOnSheet>[0]["veto"];
  /**
   * The symbol-tag vocabulary, declared here for the reason the veto above
   * is: a caller spreading `{ ...base, views }` would hand it in and
   * TypeScript would say nothing, and it would be dropped on exactly the
   * multi-view sheets. Same trap, same cure.
   */
  planText?: Parameters<typeof findWallsOnSheet>[0]["planText"];
}): ViewWalls[] {
  const bands = input.views
    .map((view) => ({
      view,
      segments: input.segments.filter((one) => {
        const mx = (one.x1 + one.x2) / 2 / input.pageSize.widthPt;
        const my = (one.y1 + one.y2) / 2 / input.pageSize.widthPt;
        // EACH OWNED BOX, not their bounding box — see `insideView`.
        return insideView(view, mx, my);
      }),
    }))
    // A VIEW WITH NO READABLE SCALE IS DROPPED HERE AND NOT EARLIER. By this
    // point `viewsInRegions` has already given it its region, so the geometry
    // inside it belongs to nobody and is measured by nobody — which is the
    // only honest answer for a drawing captioned NTS.
    //
    // ── AND ONLY A PLAN IS MEASURED AT ALL ──
    //
    // Added 2026-10-17. An interior elevation of a wall is two parallel lines a
    // wall-thickness apart running the height of that wall, which is a textbook
    // wall by every geometric test in this repo — so nothing downstream can
    // refuse it, and on A120 eight of them went into the quantities. The only
    // thing that separates a plan from an elevation OF THE SAME WALL is the
    // caption, so the caption decides.
    //
    // A caption nobody recognises is NOT measured either, and that is the part
    // worth defending: `viewKind` returns `check` for it and `excludedViews`
    // puts it in the caution by name. Measuring an unrecognised drawing is how
    // this defect happened; dropping it without a word would be the same
    // failure with better manners.
    .filter((band) => band.segments.length > 0 && band.view.textBlock !== true && (isPlanView(band.view.name) || isLevelPlan(band.view.name)));

  // ── A SHEET WHOSE PLANS PRINT NO SCALE IS NOT A SHEET WITH NO PLANS ──
  //
  // Dropping a view with no readable scale is right while ANOTHER view on the
  // sheet has one: the sheet is then drawn at more than one scale, the
  // calibration belongs to whichever view it was taken from, and measuring
  // the others at it would be inventing a scale for them.
  //
  // It is wrong when NO view on the sheet prints a scale. Murray A101 (page
  // 24) is two views — "1st Floor Plan" and "1st Floor Reflected Ceiling
  // Plan" — and neither caption carries one. Every band was dropped,
  // `wallsPerView` returned nothing, `primaryView` had nothing to pick, and
  // the viewer took its deliberate empty result: "Nothing to review on this
  // sheet", on a sheet the finder reads perfectly well. Driven directly at
  // the calibrated scale it offers 731 pairings and 158 runs.
  //
  // The user had already answered the question the filter was asking. They
  // calibrated the sheet — 23 ft across a known span, 288 ft per page width —
  // and `feetPerUnit` is that answer, passed in and then ignored.
  //
  // So: prefer the views that print their own scale, and fall back to the
  // calibrated one only when NOT ONE of them does. The multi-scale protection
  // is untouched, because it only applies where a printed scale exists to
  // protect. `isPlanView` still refuses the elevations and the schedules —
  // that is the guard that stopped eight elevations reaching the quantities,
  // and this does not relax it.
  const printed = bands.filter((band) => band.view.feetPerInch !== null);
  const measurable = printed.length > 0 ? printed : bands;
  if (measurable.length === 0) return [];

  const measure = (band: (typeof measurable)[number], feetPerUnit: number): ViewWalls => {
    const found = findWallsOnSheet({
      segments: band.segments as StrokeSegment[],
      textItems: input.textItems,
      pageSize: input.pageSize,
      feetPerUnit,
      wallTypes: input.wallTypes,
      sampledSheets: input.sampledSheets ?? null,
      ...(input.planText === undefined ? {} : { planText: input.planText }),
      // ── WHY THIS IS HERE AND NOT ONLY AT THE VIEWER'S OWN CALL ──
      //
      // A sheet carrying several plan views is measured view by view, and the
      // viewer then takes `picked.primary.found` rather than running the
      // finder itself. Answer-key mode collected candidates only at the
      // viewer's call, so on exactly those sheets it collected none — Save to
      // labels refused every multi-view sheet with "no pairings were
      // captured", which is most real bid-package sheets.
      onCandidate: input.onCandidate,
      // The veto, which this call omitted while the type had no field for
      // it — so a spread caller's model was dropped and the sheet measured
      // by the rules alone. See the `veto` field above.
      veto: input.veto,
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
  const first = measurable.map((band) => measure(band, input.feetPerUnit));
  let bestAt = 0;
  for (let i = 1; i < first.length; i += 1) {
    if (first[i].lengthFeet > first[bestAt].lengthFeet) bestAt = i;
  }
  const anchor = first[bestAt].view.feetPerInch ?? 0;

  // PASS TWO, the others at their captioned ratio to it. A caption that cannot
  // be read as a scale never reaches here — `printedScalesAt` only emits
  // standard ones — so the ratio is always between two real numbers.
  return first.map((already, i) => {
    // `measurable`, NOT `bands`: they are different arrays whenever any view
    // prints a scale, and indexing the wrong one measures a view at its
    // neighbour's ratio. `first` was built from `measurable`, so the index
    // belongs to it.
    const mine = measurable[i].view.feetPerInch ?? 0;
    if (i === bestAt || !(anchor > 0) || !(mine > 0)) return already;
    const ratio = mine / anchor;
    if (ratio === 1) return already;
    return measure(measurable[i], input.feetPerUnit * ratio);
  });
}

/**
 * ── EVERY VIEW THAT CAN BE MEASURED FROM ITS OWN CAPTION, AND AT WHAT ──
 *
 * `wallsPerView` measures views RELATIVE to a scale the sheet already has: it
 * anchors on the view the calibration is about and takes everyone else at
 * their captioned ratio to it. That is the right shape when a sheet HAS a
 * trusted scale, because a measured dimension is better evidence than a
 * printed caption and the anchor keeps it in charge.
 *
 * It is the wrong shape when the sheet has no scale at all, and that is the
 * common case on a real set. `readSheetScale` declines a sheet whose printed
 * dimensions do not agree — and a sheet carrying several drawings at several
 * scales is exactly a sheet whose dimensions do not agree, because they are
 * dimensions of different drawings. The sheet was then reported as "no scale"
 * and nothing on it was measured, although every drawing on it was captioned.
 *
 * A caption is an absolute ratio — `1/8" = 1'-0"` is feet per paper inch and
 * needs nothing else to become feet per page unit. So a view with a caption
 * can always be measured on its own, and this is what says so.
 *
 * ── IT IS STILL THE WEAKER EVIDENCE, AND THE CALLER MUST KEEP IT SECOND ──
 *
 * A dimension printed on the drawing can be checked AGAINST the drawing; a
 * caption cannot, and a caption is wrong whenever somebody rescales a detail
 * and does not retype it. The same reason `scaleFromPrinted` runs only after
 * the dimensions decline. This exists to turn "nothing measured" into
 * "measured, from the caption, and labelled as such" — never to overrule a
 * dimension.
 */
export function viewsWithOwnScale(
  views: readonly SheetView[],
  widthPt: number,
): { view: SheetView; feetPerUnit: number }[] {
  if (!(widthPt > 0)) return [];
  const out: { view: SheetView; feetPerUnit: number }[] = [];
  for (const view of views) {
    // NTS and AS NOTED arrive here as null, and stay unmeasured. A drawing
    // whose own caption refuses to name a scale is not one to guess at.
    if (view.feetPerInch === null || !(view.feetPerInch > 0)) continue;
    // ── AND ONLY A PLAN, WHICH IS THE SAME RULE `wallsPerView` APPLIES ──
    //
    // Added 2026-10-17 and it belongs HERE rather than in each caller, which
    // is the whole point. `realSheets.eval.ts` has its own per-view loop over
    // this function's output, and on A120 it measured all nine views —
    // 567 ft including eight interior elevations — while the app's own
    // `wallsPerView` measured only the plan. One rule in two places is one
    // rule in one place and a copy that drifted, which CLAUDE.md records this
    // repo paying for twice.
    //
    // It also improves the SCALE this feeds: `sheetScale.ts` asks this
    // question to prefill a calibration, and A120's answer should be the
    // enlarged plan's 1/2" rather than an elevation's 3/8".
    if (!isPlanView(view.name)) continue;
    out.push({ view, feetPerUnit: (widthPt / 72) * view.feetPerInch });
  }
  return out;
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
  const out: ExcludedView[] = [];
  for (const view of views) {
    if (view.textBlock === true) {
      out.push({ name: view.name, reason: "notes, a legend or a schedule, not a drawing" });
      continue;
    }
    // "Penthouse Floor": a plan named by its level, measured by `wallsPerView`
    // and kept by `keptPlanViews` — it must not also be listed as "check it".
    if (isLevelPlan(view.name)) {
      if (view.feetPerInch === null) out.push({ name: view.name, reason: "not to scale, not measured" });
      continue;
    }
    // ── WHAT KIND IT IS COMES FIRST, BECAUSE IT IS THE MORE USEFUL SENTENCE ──
    //
    // An elevation captioned `3/8" = 1'-0"` has a perfectly readable scale, so
    // the older test here passed it over in silence and it was measured. Both
    // reasons can be true of one drawing; "an elevation" is the one an
    // estimator can check against the sheet, and "not to scale" is only
    // interesting for a drawing they would otherwise expect to see measured.
    const kind = viewKind(view.name);
    if (kind.kind === "not-a-plan") {
      // ── BOTH FACTS, WHERE BOTH ARE TRUE ──
      //
      // A wall detail captioned NTS is a detail AND unscaled, and the older
      // test here asserts the second — for the right reason, which it states:
      // "skipped" tells somebody to worry and a specific reason lets them
      // decide whether it matters. What it is comes first because it is the
      // more useful half and the more stable one, and the scale follows
      // instead of being dropped.
      out.push({
        name: view.name,
        reason: view.feetPerInch === null ? `${kind.why}, not to scale, not measured` : kind.why,
      });
      continue;
    }
    if (kind.kind === "check") {
      out.push({ name: view.name, reason: `${kind.why} — check it` });
      continue;
    }
    if (view.feetPerInch === null) {
      out.push({ name: view.name, reason: "not to scale, not measured" });
    }
  }
  return out;
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
  // ── WHAT THE DRAWING IS BEATS HOW MUCH IS DRAWN ON IT ──
  //
  // This sorted on footage alone, and on a sheet carrying four views of one
  // floor — finish, lighting, partition, RCP — the lighting plan won. It is
  // the same building drawn at the same scale, so the view with the most line
  // work is a question about drafting, not about which drawing prices the job.
  // A decorative lighting layout has more of it than the partition plan it is
  // drawn over.
  //
  // `takeoffRank` already ranks these captions and `viewKind` already asks it,
  // so this asks the same function rather than restating the vocabulary. It is
  // the ordering that was missing, not the words — DIMENSIONED FLOOR PLAN 100,
  // FLOOR PLAN and PARTITION PLAN 90, ENLARGED PLAN 70, anything else saying
  // PLAN 40.
  //
  // Footage stays as the tie-break, which is what decides between two views
  // that are the same KIND of drawing: a floor plan and a partition plan both
  // score 90, and then the one with more building on it is the right answer.
  //
  // ── ONLY THE PICK MOVES, AND THE REST STAY BIGGEST-FIRST ──
  //
  // Ranking the whole list reordered `others` too, which an existing test
  // caught: the caution names the views that were NOT measured, and an
  // estimator scanning that list wants the biggest first. That ordering was
  // never part of this defect, so it is left alone.
  //
  // `reduce` replaces only on a STRICTLY higher score, over a list already
  // sorted biggest-first, so two views of the same kind fall to the one with
  // more building on it — the tie-break, without a second comparator.
  const byFootage = [...measured].sort((a, b) => b.lengthFeet - a.lengthFeet);
  const best = byFootage.reduce((pick, one) =>
    takeoffRank(null, one.view.name).score > takeoffRank(null, pick.view.name).score ? one : pick,
  );
  return { primary: best, others: byFootage.filter((one) => one !== best) };
}

/**
 * ── EVERY DRAWING ON THE SHEET, FOUND BY TITLE OR BY CAPTION ──
 *
 * Added 2026-10-22. `sheetViews` is scale-limited (see `viewTitles.ts` for the
 * measurement); this unions it with the drawings whose titles are lettered big
 * and ruled, which a sheet prints whether or not it prints a scale under each.
 * A title that already has a caption within one line of lettering is the same
 * drawing and is not added twice. Each drawing then takes its region from the
 * sheet's gutters exactly as a captioned view does.
 *
 * ── THE SHEET'S OWN TITLE, WHICH IS BIG, RULED, AND NOT A DRAWING ──
 *
 * "OVERALL FLOOR PLAN" in the title block is lettered like a view title. It
 * is told apart by being a REPEAT: the sheet is named after the drawing on
 * it, so the title block's title duplicates a caption's, bubble number
 * aside. A title in the bottom tenth of the page is the title block's too.
 * A rule on the RIGHT strip was tried first and dropped Crosslines' two
 * penthouse plans, which are drawn exactly there.
 *
 * When nothing is found by either route the result is empty, and the caller
 * measures the sheet whole — the ELEVEN03 fallback.
 */
const TITLE_BLOCK_FOOT = 0.1;

/** A title with its bubble number and punctuation stripped, for the repeat test. */
function titleKey(name: string): string {
  return name.toUpperCase().replace(/^[\s\dA-Z]{1,2}\b[\s.:-]*/, "").replace(/[^A-Z0-9]+/g, " ").trim();
}

/** One line of lettering, in page-width units — the margin a caption keeps from its own drawing's edge. */
const CAPTION_MARGIN = 0.02;

type Box = { from: number; to: number; fromY: number; toY: number };

/**
 * ── A DRAWING SITS ABOVE ITS CAPTION; A HEADING SITS ABOVE ITS WORDS ──
 *
 * `viewsInRegions` cuts a shared region at the MIDPOINT between captions,
 * which is right when captions are centred on their drawings and wrong for
 * the convention US sets actually follow: the bubble-and-title caption is
 * lettered at the bottom-left of the drawing it names. Three plans stacked
 * on Crosslines A100 are captioned at y 0.27, 0.56 and 0.85; the midpoint
 * cuts at 0.42 and 0.70 put the top half of each lower plan in the drawing
 * above it. Measured: 1,153 ft of key wall lost on that sheet alone.
 *
 * So a shared region is cut just BELOW each caption on the y axis (a
 * drawing runs from the caption above it down to its own caption), and just
 * LEFT of each caption on the x axis (a drawing runs from its own caption
 * across to the next one's). A text block is the mirror: its heading is at
 * the TOP, so it claims only the region it sits in, and only when no drawing
 * caption shares that region — it never joins a neighbour and never has a
 * neighbour joined to it. Orphan regions still join the nearest DRAWING
 * caption, for the reason `viewsInRegions` records (the S05/S07 dimension
 * strip).
 */
export function placeDrawings(views: readonly SheetView[], regions: readonly Box[]): SheetView[] {
  if (views.length === 0) return [];
  const drawings = views.filter((v) => v.textBlock !== true);
  const blocks = views.filter((v) => v.textBlock === true);
  const inside = (v: SheetView, r: Box) => v.captionX >= r.from && v.captionX < r.to && v.captionY >= r.fromY && v.captionY < r.toY;

  // Blocks first: a region holding only headings is theirs and leaves the pool.
  const blockBoxes = new Map<SheetView, Box[]>();
  const pool: Box[] = [];
  for (const r of regions) {
    const heads = blocks.filter((b) => inside(b, r));
    if (heads.length > 0 && !drawings.some((d) => inside(d, r))) {
      for (const h of heads) blockBoxes.set(h, [...(blockBoxes.get(h) ?? []), r]);
    } else {
      pool.push(r);
    }
  }

  // A region holding several captions is cut at their caption lines — just
  // below a drawing's caption and just ABOVE a block's heading, since a
  // heading sits over its words — and just left of either on x. A notes
  // column that shares a gutter-free region with the plan's caption (NG A3.2)
  // otherwise leaves its blocks with no pieces and the plan with the column.
  const shared: Box[] = [];
  for (const r of pool) {
    const here = drawings.filter((d) => inside(d, r));
    const heads = blocks.filter((b) => inside(b, r));
    if (here.length + heads.length < 2) {
      shared.push(r);
      continue;
    }
    const lines = (values: number[], lo: number, hi: number) => {
      const sorted = [...new Set(values)].sort((a, b) => a - b);
      const cuts: number[] = [];
      for (const at of sorted) {
        if (at <= lo + CAPTION_MARGIN || at >= hi - CAPTION_MARGIN) continue;
        if (cuts.length > 0 && at - cuts[cuts.length - 1] <= CAPTION_SAME_LINE) continue;
        cuts.push(at);
      }
      return [lo, ...cuts, hi];
    };
    const xs = lines([...here, ...heads].map((d) => d.captionX - CAPTION_MARGIN), r.from, r.to);
    const ys = lines([...here.map((d) => d.captionY + CAPTION_MARGIN), ...heads.map((b) => b.captionY - CAPTION_MARGIN)], r.fromY, r.toY);
    for (let i = 0; i < xs.length - 1; i += 1) {
      for (let j = 0; j < ys.length - 1; j += 1) shared.push({ from: xs[i], to: xs[i + 1], fromY: ys[j], toY: ys[j + 1] });
    }
  }

  // The piece that STARTS at a block's heading, with no drawing caption in
  // it, is that block's: the words under "PARTITION TYPES" are not the
  // plan's. Only that piece — the cuts above put the next caption line at its
  // bottom — because a heading at the top of a column claiming every cell
  // beneath it took the plan's right end on NG A3.2.
  const claimedByBlock = new Set<Box>();
  for (const piece of shared) {
    if (drawings.some((d) => inside(d, piece))) continue;
    let at: SheetView | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const b of blocks) {
      const under = Math.abs(piece.fromY - (b.captionY - CAPTION_MARGIN)) <= CAPTION_MARGIN && piece.from <= b.captionX && b.captionX < piece.to + CAPTION_MARGIN;
      if (!under) continue;
      const d2 = piece.fromY - b.captionY;
      if (d2 < bestD) {
        bestD = d2;
        at = b;
      }
    }
    if (at !== null) {
      blockBoxes.set(at, [...(blockBoxes.get(at) ?? []), piece]);
      claimedByBlock.add(piece);
    }
  }

  // Each piece goes to the nearest drawing caption that could OWN it. A
  // drawing sits above and to the right of its caption, so a caption is
  // disqualified from any piece wholly below it or wholly to its left — the
  // cell under Crosslines' "Penthouse Roof" caption holds the right end of
  // the two floor plans beneath, and plain distance gave it to the penthouse.
  // Plain distance is the fallback only when no caption qualifies, which is
  // the orphan dimension strip of the S05/S07 scar.
  const mine = new Map<SheetView, Box[]>();
  const qualifies = (d: SheetView, piece: Box) => !(piece.fromY >= d.captionY + CAPTION_MARGIN || piece.to <= d.captionX - CAPTION_MARGIN);
  const distance = (d: SheetView, piece: Box) => {
    const dx = Math.max(piece.from - d.captionX - CAPTION_MARGIN, 0, d.captionX - piece.to);
    const dy = Math.max(piece.fromY - d.captionY - CAPTION_MARGIN, 0, d.captionY - piece.toY);
    return Math.hypot(dx, dy);
  };
  for (const piece of shared) {
    if (claimedByBlock.has(piece)) continue;
    const pool2 = drawings.filter((d) => qualifies(d, piece));
    const candidates = pool2.length > 0 ? pool2 : drawings;
    let at: SheetView | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const d of candidates) {
      const d2 = distance(d, piece);
      if (d2 < bestD) {
        bestD = d2;
        at = d;
      }
    }
    if (at !== null) mine.set(at, [...(mine.get(at) ?? []), piece]);
  }

  const bounded = (v: SheetView, got: Box[]): SheetView => {
    if (got.length === 0) return { ...v, from: 0, to: 0, fromY: 0, toY: 0, boxes: [] };
    return {
      ...v,
      boxes: got.map((b) => ({ ...b })),
      from: Math.min(...got.map((b) => b.from)),
      to: Math.max(...got.map((b) => b.to)),
      fromY: Math.min(...got.map((b) => b.fromY)),
      toY: Math.max(...got.map((b) => b.toY)),
    };
  };
  return views.map((v) => bounded(v, (v.textBlock === true ? blockBoxes.get(v) : mine.get(v)) ?? []));
}

/**
 * ── EVERY DRAWING ON THE SHEET, FOUND BY TITLE OR BY CAPTION ──
 *
 * Added 2026-10-22. `sheetViews` is scale-limited (see `viewTitles.ts` for the
 * measurement); this unions it with the drawings whose titles are lettered big
 * and ruled, which a sheet prints whether or not it prints a scale under each.
 * A title that already has a caption within one line of lettering is the same
 * drawing and is not added twice. A title whose words name a notes column, a
 * legend or a table becomes a TEXT BLOCK — found so its region is kept out of
 * every drawing, never measured. A title naming nothing recognisable is
 * dropped unless a scale is printed under it, because the first sweep found
 * those are an architect's address, "(NO WORK)" over a hatched area, and
 * fragments of wrapped notes — and each one, kept, took a region off a plan.
 *
 * ── THE SHEET'S OWN TITLE, WHICH IS BIG, RULED, AND NOT A DRAWING ──
 *
 * "FLOOR PLAN" in the title block is lettered like a view title. It is told
 * apart by WHERE it is lettered: in the page's rightmost fifth owning no more
 * than that fifth, or in the bottom tenth owning no more than that.
 *
 * When nothing is found by either route the result is empty, and the caller
 * measures the sheet whole — the ELEVEN03 fallback.
 */
export function sheetDrawings(input: {
  items: readonly { str: string; x: number; y: number; width: number; height: number }[];
  segments: readonly StrokeSegment[];
  pageSize: { widthPt: number; heightPt: number };
  sizeRatio?: number;
}): SheetView[] {
  const W = input.pageSize.widthPt;
  if (!(W > 0)) return [];
  const captions = sheetViews(input.items, W).map((v) => ({ ...v, foundBy: "caption" as const, textBlock: viewClass(v.name).kind === "text-block" }));
  const titles = viewTitles({ items: input.items, segments: input.segments, widthPt: W, sizeRatio: input.sizeRatio });
  const scales = printedScalesAt(input.items);
  const found: SheetView[] = [...captions];
  for (const title of titles) {
    const twin = captions.find((c) => Math.abs(c.captionX - title.x) <= NAME_BESIDE && Math.abs(c.captionY - title.y) <= NAME_ABOVE * 2);
    if (twin !== undefined) continue;
    let scale: { name: string; feetPerInch: number } | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const s of scales) {
      const gap = s.y / W - title.y;
      if (gap <= 0 || gap > NAME_ABOVE * 2) continue;
      if (Math.abs(s.x / W - title.x) > NAME_BESIDE * 2) continue;
      if (gap < best) {
        best = gap;
        scale = { name: s.name, feetPerInch: s.feetPerInch };
      }
    }
    const kind = viewClass(title.text).kind;
    if (kind === "unknown" && scale === null) continue;
    found.push({
      name: title.text,
      scaleName: scale?.name ?? null,
      feetPerInch: scale?.feetPerInch ?? null,
      captionX: title.x,
      captionY: title.y,
      from: 0,
      to: 1,
      fromY: 0,
      toY: Number.POSITIVE_INFINITY,
      foundBy: "title",
      textBlock: kind === "text-block",
    });
  }
  if (found.length === 0) return [];
  found.sort((a, b) => a.captionX - b.captionX);
  const H = input.pageSize.heightPt / W;
  const kept = found.filter((v) => {
    if (v.foundBy !== "title") return true;
    if (v.captionY >= H - TITLE_BLOCK_FOOT) return false;
    const repeats = found.some((o) => o !== v && (o.foundBy === "caption" || o.captionX < v.captionX) && titleKey(o.name) === titleKey(v.name));
    return !repeats;
  });
  return placeDrawings(kept, viewRegions(input.segments, input.pageSize));
}

/**
 * How many DRAWINGS a set of views holds — the count a caller should branch
 * on. A sheet whose only found views are a legend and a keynote list is a
 * single-drawing sheet with two headings, and the multi-view path would
 * measure nothing on it: Bunkie A100 lost its whole key that way.
 */
export function drawingCount(views: readonly SheetView[]): number {
  return views.filter((v) => v.textBlock !== true).length;
}

/** The regions the sheet's text blocks own — a legend, a notes column, a schedule — to keep out of any drawing. */
export function textBlockBoxes(views: readonly SheetView[]): { from: number; to: number; fromY: number; toY: number }[] {
  return views.filter((v) => v.textBlock === true).flatMap((v) => v.boxes ?? []);
}

/**
 * ── EVERY FLOOR KEEPS ITS WALLS; A FLOOR DRAWN TWICE KEEPS ONE ──
 *
 * `primaryView` keeps ONE view's detection, for the product rule it states:
 * an enlarged plan is the same construction drawn larger, and a finish plan
 * over a partition plan is the same walls twice. That rule, applied to
 * Crosslines A100 — a 1st-floor plan, a 2nd-9th typical-floor plan and a
 * penthouse plan on one sheet — threw away two floors of building: 1,014 ft
 * of the key, every run of it a wall the reviewer accepted.
 *
 * The two cases are told apart by the LEVEL the title names. Two plan views
 * naming different levels are different floors and both are kept, each at
 * its own scale as `wallsPerView` measured it. Views naming the same level,
 * or none — "DIMENSION PLAN - WAREHOUSE" beside "FLOOR PLAN - WAREHOUSE",
 * which are one warehouse — fall to `primaryView` among themselves, exactly
 * as before. An enlarged plan is never added to a floor it is part of.
 */
/** The measured plan views whose walls the sheet keeps, one per level named, and the rest. */
export function keptPlanViews(measured: readonly ViewWalls[]): { kept: ViewWalls[]; others: ViewWalls[] } {
  if (measured.length === 0) return { kept: [], others: [] };
  const floors = measured.filter((m) => viewClass(m.view.name).kind !== "enlarged-plan");
  if (floors.length === 0) {
    const p = primaryView(measured);
    return { kept: p.primary === null ? [] : [p.primary], others: p.others };
  }
  const byLevel = new Map<string, ViewWalls[]>();
  for (const m of floors) {
    const level = planLevel(m.view.name) ?? "";
    byLevel.set(level, [...(byLevel.get(level) ?? []), m]);
  }
  const kept: ViewWalls[] = [];
  for (const group of byLevel.values()) {
    const p = primaryView(group);
    if (p.primary !== null) kept.push(p.primary);
  }
  kept.sort((a, b) => b.lengthFeet - a.lengthFeet);
  return { kept, others: measured.filter((m) => !kept.includes(m)).sort((a, b) => b.lengthFeet - a.lengthFeet) };
}

/**
 * One detection out of several views' — the walls of every kept floor, each
 * already measured at its own scale. Counts are summed, lists concatenated,
 * and `regroup` is the first kept view's, which groups by geometry and so
 * serves the union as it served the one.
 */
export function mergeViewWalls(kept: readonly ViewWalls[]): FoundOnSheet | null {
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0].found;
  const [first, ...rest] = kept.map((k) => k.found);
  return {
    ...first,
    inUnits: kept.flatMap((k) => k.found.inUnits),
    gridDropped: kept.reduce((n, k) => n + k.found.gridDropped, 0),
    hatchDropped: kept.reduce((n, k) => n + k.found.hatchDropped, 0),
    duplicateDropped: kept.reduce((n, k) => n + k.found.duplicateDropped, 0),
    templateDropped: kept.reduce((n, k) => n + k.found.templateDropped, 0),
    everywhere: kept.flatMap((k) => k.found.everywhere),
    inBuilding: kept.flatMap((k) => k.found.inBuilding),
    notLettering: kept.flatMap((k) => k.found.notLettering),
    notBorder: kept.flatMap((k) => k.found.notBorder),
    walls: kept.flatMap((k) => k.found.walls),
    clusters: kept.flatMap((k) => k.found.clusters),
    groups: kept.flatMap((k) => k.found.groups),
    layerDropped: [first.layerDropped, ...rest.map((r) => r.layerDropped)].flat(),
  };
}
