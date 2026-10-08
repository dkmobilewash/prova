import { roomGrid, neighboursOf, SMALLEST_ROOM_SQFT } from "./rooms";
import { squaredDistanceToInk, widestPointOf } from "./distance";
import { thin, tracePaths, straighten } from "./skeleton";
import type { StrokeSegment, WallCandidate, WallFinderOptions } from "./wallVectors";

/**
 * ── THE ROOM ENGINE, IN THE SHAPE THE APP ALREADY TAKES ──
 *
 * `wallsFromStrokes` asks "are these two lines a wall", which cannot be
 * complete: recall settled near 40% across four real plan sets, and an estimator
 * cannot bid from an unknown 40%. `rooms.ts`, `distance.ts` and `skeleton.ts` ask
 * the question that can be — which enclosed regions are thin, and which of those
 * separate two different spaces — and on a real sheet they answer it correctly.
 *
 * This file is the adapter, and the adapter IS the design decision. It returns
 * `WallCandidate[]`, the same straight-centreline shape the line pairer returns,
 * so everything downstream keeps working untouched:
 *
 *   `wallsInTheBuilding`    rejects the title block and the detail blocks
 *   `wallsNotLettering`     rejects line work inside a text item's box
 *   `wallsNotTheSheetBorder` rejects the border itself
 *   `clusterByThickness`    groups the result for the accept panel
 *   the viewer's SVG overlay draws them with no change at all
 *
 * Those four were written for the pairer, are measured, and are three of the
 * rules this feature's rule-table calls built. Reproducing them against regions
 * would be a second implementation of a solved problem — and this repo has an
 * entry about what a second copy of a list costs. So the engine changes and the
 * filters do not.
 *
 * ── WHAT IT DOES NOT FIND, STATED RATHER THAN ASSUMED ──
 *
 * A wall is found as the ENCLOSED REGION between its faces, so a wall that is
 * SOLID INK has no region to find. A filled poché wall normally survives that,
 * because `sheetStrokes` emits a filled path's OUTLINE and the fill's interior
 * is then an ordinary region — but hatching drawn finer than the grid fills
 * solid and is lost. `wallRuns.test.ts` pins both halves.
 *
 * Which form the real sheets use has NOT been checked. This paragraph says so
 * rather than guessing, because the first version of it claimed poché worked,
 * and the test written to prove it failed.
 *
 * ── AN L IS TWO WALLS ──
 *
 * A traced run can turn a corner. Each straight piece of it becomes its own
 * candidate, which is both what the type can express and what an estimator
 * means: a wall that turns is two walls meeting, priced as two runs.
 */

/** How much of a foot a jog must be before it counts as a corner rather than
 *  the rasteriser's staircase on a line drawn a fraction off-axis. */
const CORNER_FEET = 0.25;

/**
 * Thickness for one run, in feet, sampled along it rather than taken from its
 * region.
 *
 * A region's widest point is the right measure for deciding whether the region
 * is a wall at all; it is the wrong one for REPORTING a thickness, because one
 * region can hold several runs and the widest of them would be attributed to
 * all. The distance transform already holds the local half-width at every cell,
 * so the median along a run's own cells is both more honest and cheaper.
 *
 * The median rather than the mean: a run that ends at a junction widens where
 * the walls meet, and a mean would drag every thickness up by that corner.
 */
function thicknessAlong(
  squared: Float64Array,
  width: number,
  xs: readonly number[],
  ys: readonly number[],
  feetPerCell: number,
): number {
  const widths: number[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    widths.push(2 * Math.sqrt(squared[ys[i] * width + xs[i]]));
  }
  widths.sort((a, b) => a - b);
  const middle = widths[Math.floor(widths.length / 2)] ?? 0;
  return middle * feetPerCell;
}

/**
 * Find the walls on a sheet by finding its rooms.
 *
 * `widthUnits`/`heightUnits` are the page's extent in whatever units the
 * segments use, and `feetPerPoint` converts those units to feet — the same
 * contract `wallsFromStrokes` takes, so a caller swapping one for the other
 * changes nothing but the call.
 */
export function wallRunsFromStrokes(
  segments: readonly StrokeSegment[],
  widthUnits: number,
  heightUnits: number,
  options: WallFinderOptions & { gridCap?: number },
): WallCandidate[] {
  const feetPerUnit = options.feetPerPoint;
  const minThickness = options.minThicknessFeet ?? 0.2;
  const maxThickness = options.maxThicknessFeet ?? 1.5;
  const minLength = options.minLengthFeet ?? 2;
  if (!(feetPerUnit > 0) || segments.length === 0) return [];

  const grid = roomGrid(segments, widthUnits, heightUnits, feetPerUnit, options.gridCap);
  if (grid.regions.length === 0) return [];

  // A cell with no region is ink; that is the same array the flood fill walked,
  // so the two cannot disagree about where the lines are.
  const ink = new Uint8Array(grid.label.length);
  for (let i = 0; i < ink.length; i += 1) ink[i] = grid.label[i] === -1 ? 1 : 0;
  const squared = squaredDistanceToInk(ink, grid.width, grid.height);

  const sqft = grid.feetPerCell ** 2;
  const enclosed = grid.regions.filter((r) => !r.open);
  const widthFeet = new Map(
    enclosed.map((r) => [r.id, widestPointOf(squared, grid.label, r.id, r, grid.width) * grid.feetPerCell]),
  );

  /**
   * What counts as a SPACE for the different-room-on-each-side test.
   *
   * It must be WIDER than a wall, not merely larger. A hatch strip is long, so
   * it clears any area floor on its own — and then counts as the room on the far
   * side of the next strip along, which made every diagonal hatch block on a
   * real sheet come out solid as wall. Requiring a real width removes them, and
   * the sheet border with them.
   */
  const isSpace = new Set(
    grid.regions
      .filter((r) => r.open || (r.area * sqft >= SMALLEST_ROOM_SQFT && (widthFeet.get(r.id) ?? 0) > maxThickness))
      .map((r) => r.id),
  );

  const wallRegions = enclosed.filter((r) => {
    const w = widthFeet.get(r.id) ?? 0;
    if (w < minThickness || w > maxThickness) return false;
    // THE RULE: a wall has a different room on each side. A dimension gap, a
    // door-swing gap and a furniture gap all have the SAME room on both sides.
    return neighboursOf(grid, r).touching.filter((id) => isSpace.has(id)).length >= 2;
  });
  if (wallRegions.length === 0) return [];

  const wallIds = new Set(wallRegions.map((r) => r.id));
  const mask = new Uint8Array(grid.label.length);
  for (let i = 0; i < mask.length; i += 1) if (wallIds.has(grid.label[i])) mask[i] = 1;

  const skeleton = thin(mask, grid.width, grid.height);
  const tolerance = CORNER_FEET / grid.feetPerCell;
  const unitsPerCellX = widthUnits / grid.width;
  const unitsPerCellY = heightUnits / grid.height;

  const walls: WallCandidate[] = [];
  for (const traced of tracePaths(skeleton, grid.width, grid.height)) {
    // Measured on the TRACED path, before straightening throws away the cells
    // the thickness is sampled from.
    const thicknessFeet = thicknessAlong(squared, grid.width, traced.xs, traced.ys, grid.feetPerCell);
    if (thicknessFeet < minThickness || thicknessFeet > maxThickness) continue;
    const line = straighten(traced, tolerance);
    for (let i = 1; i < line.xs.length; i += 1) {
      const x1 = line.xs[i - 1] * unitsPerCellX;
      const y1 = line.ys[i - 1] * unitsPerCellY;
      const x2 = line.xs[i] * unitsPerCellX;
      const y2 = line.ys[i] * unitsPerCellY;
      const lengthFeet = Math.hypot(x2 - x1, y2 - y1) * feetPerUnit;
      if (lengthFeet < minLength) continue;
      walls.push({ x1, y1, x2, y2, thicknessFeet, lengthFeet });
    }
  }
  return walls;
}
