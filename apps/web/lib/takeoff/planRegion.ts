import type { StrokeSegment } from "./wallVectors";

export type Region = { from: number; to: number; fromY: number; toY: number };

/**
 * ── WHICH PART OF A ONE-DRAWING SHEET IS THE DRAWING ──
 *
 * `viewRegions` cuts a sheet where there is nothing drawn, and on A102 it
 * already separates the three things on that page:
 *
 *   | region | strokes | words |
 *   | --- | --- | --- |
 *   | x 0.000..0.068 | 1 | 0 |
 *   | **x 0.068..0.897** | **135,042** | 313 |
 *   | x 0.897..1.000 | 8,395 | 88 |
 *
 * The middle one is the floor plan; the last is the title block, the notes and
 * the legend boxes. A sheet with ONE caption then hands all three to that
 * caption — a region with no caption of its own joins the nearest, which is
 * the rule that keeps a plan's dimension column with its plan and which sent
 * S05 and S07 to zero feet when it ran the other way round.
 *
 * So the plan's own extent went unused on exactly the sheets that have one
 * drawing, and an answer-key reviewer was offered the title block's ruled
 * lines and the revision block's as possible walls.
 *
 * ── THE BIGGEST, AND WHATEVER IS COMPARABLE TO IT ──
 *
 * Not "the biggest region" alone: a plan split by an internal gutter — a
 * courtyard, a wide corridor of white space — is two regions and both are the
 * drawing. So the test is relative, and a region holding a tenth of what the
 * busiest holds is kept.
 *
 * On A102 the title block is 6.2% of the drawing's stroke count and the
 * dimension strip is 0.0007%, so a tenth sits in a gap rather than on a line.
 * The number that would be wrong here is one chosen tight enough to split a
 * courtyard off a plan.
 *
 * ── WHY THIS CANNOT REINTRODUCE THE S05/S07 SCAR ──
 *
 * That scar was a caption CHOOSING a thin strip and the building being outside
 * the only region anybody measured. This keeps the busiest region by
 * construction, which is where a building is: the failure mode it can have is
 * dropping a small SECOND drawing, and a sheet with a second drawing has a
 * second caption and never reaches this function.
 */

/** How much of the busiest region's geometry a region must hold to be part of
 *  the drawing. See the header: 6.2% against 100% on the sheet this was
 *  measured on, so a tenth is a gap rather than a line. */
const SHARE_OF_BUSIEST = 0.1;

/**
 * The regions that hold the drawing, or every region when that cannot be told.
 *
 * Returns the input unchanged when there is one region or none, because there
 * is then nothing to choose between and a filter that cannot distinguish must
 * not pretend to.
 */
export function drawingRegions(
  regions: readonly Region[],
  segments: readonly StrokeSegment[],
  widthPt: number,
): Region[] {
  if (regions.length <= 1 || segments.length === 0 || !(widthPt > 0)) return [...regions];

  const counts = regions.map((region) => {
    let n = 0;
    for (const one of segments) {
      const mx = (one.x1 + one.x2) / 2 / widthPt;
      const my = (one.y1 + one.y2) / 2 / widthPt;
      if (mx >= region.from && mx < region.to && my >= region.fromY && my < region.toY) n += 1;
    }
    return n;
  });

  const busiest = Math.max(...counts);
  if (busiest === 0) return [...regions];
  const kept = regions.filter((_, at) => counts[at] >= busiest * SHARE_OF_BUSIEST);
  // Cannot return nothing: the busiest region always passes its own test.
  return kept.length > 0 ? kept : [...regions];
}

/** Is a point, in page-width units, inside any of these regions? */
export function insideRegions(regions: readonly Region[], mx: number, my: number): boolean {
  if (regions.length === 0) return true;
  return regions.some(
    (region) => mx >= region.from && mx < region.to && my >= region.fromY && my < region.toY,
  );
}

/** The segments whose midpoint lies in one of these regions. `widthPt` converts
 *  segment coordinates into the page-width units the regions are in. */
export function segmentsInRegions(
  segments: readonly StrokeSegment[],
  regions: readonly Region[],
  widthPt: number,
): StrokeSegment[] {
  if (regions.length === 0 || !(widthPt > 0)) return [...segments];
  return segments.filter((one) =>
    insideRegions(regions, (one.x1 + one.x2) / 2 / widthPt, (one.y1 + one.y2) / 2 / widthPt),
  );
}
