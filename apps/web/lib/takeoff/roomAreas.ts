/**
 * ── NOTHING CALLS THIS, AND THE REASON IS A MEASUREMENT ──
 *
 * #702 wired it to a button. It was clicked on real sheets the same day and
 * the answer was wrong in the way that matters most: **confidently low**. On a
 * West Herr floor plan it reported 46 rooms and 4,555 sf for a building about
 * 290 ft across, having missed Showroom 101, Sales 103, Hospitality 105, New
 * Car Delivery 140 and the whole right-hand wing — while outlining a parked
 * car, the gaps between dimension strings, and two keynote tags. On Augusta,
 * Conference 1102 came back cut in half along its own 15ft-8in dimension line,
 * and an outline ran diagonally across Mechanical 1101 along the "EXISTING
 * HVAC" leader.
 *
 * ── EVERY ONE OF THOSE IS THE SAME CAUSE, AND IT IS NOT A THRESHOLD ──
 *
 * This file rasterises EVERY STROKE the sheet carries, and a floor plan is not
 * only walls:
 *
 *   a leader line crossing a room   cuts its region in two
 *   a dimension string              encloses a region of its own
 *   a keynote tag, a car, a desk    is a closed outline, so a region
 *   the biggest rooms               are the most crossed, so the most
 *                                   fragmented — which is why they are the
 *                                   ones that vanish
 *
 * `wallVectors.ts` has `wallsNotLettering`, `wallsInTheBuilding` and
 * `wallsNotTheSheetBorder` for exactly this, each added after somebody looked
 * at real output. THIS HAS NONE OF THEM, and the box does not help: every one
 * of those strokes is inside the box, drawn on top of the plan.
 *
 * The geometry below is right — `traceRing` and the ring maths are tested and
 * mutation-held. What is wrong is WHAT REACHES THEM. That is the fix, and
 * until its numbers say otherwise there is no button:
 * `takeoffRoomFinder.test.tsx` asserts the toolbar offers none.
 *
 * ── THE CHECK I SHOULD HAVE MADE AND DID NOT ──
 *
 * I rendered the regions as flat colour and asked "do these look like rooms".
 * They did. The question that finds this in a minute is the other one: IS
 * SHOWROOM 101 AMONG THEM? A detector is judged by what it MISSES, and a
 * picture of what it found cannot show that.
 */

import { openingsInWalls } from "./openings";
import { straighten } from "./skeleton";
import { roomGrid, wallsFromRooms, SMALLEST_ROOM_SQFT, WIDEST_WALL_INCHES, type RoomGrid } from "./rooms";
import type { StrokeSegment } from "./wallVectors";

/**
 * ── THE ROOMS INSIDE A BOX THE ESTIMATOR DREW ──
 *
 * Area is the largest measurement still traced entirely by hand: ceilings,
 * flooring and paint all need it, and on a 20,000 sf plan it is a hundred-odd
 * polygons drawn one corner at a time.
 *
 * `rooms.ts` already finds enclosed regions and `wallsFromRooms` already knows
 * which ones a wall separates. This turns those into AREA measurements, and the
 * only thing it adds is the box — which is not a convenience, it is the whole
 * reason the feature works at all.
 *
 * ── WHY THERE IS A BOX, MEASURED RATHER THAN ASSUMED ──
 *
 * Run over a whole sheet, the region finder returns every enclosed shape on the
 * page, and the non-plan ones are NOT distinguishable by geometry. At 1/8in=1ft
 * a hairline between two table cells is about half an inch thick in building
 * units and several feet long — the same shape as a wall. So the sheet margin,
 * the notes panel, the legend and every title-block cell read as rooms. On
 * Naples p9 the entire right-hand notes column came back as rooms; on Augusta
 * p11 the margin came back as one 24,789 sf room.
 *
 * Three automatic discriminators were built and measured, and all three failed:
 *
 *   - bounding-box span and fill. Catches the margin (span 82%, fill 37%) and
 *     misses Naples' drawing backgrounds, which fill 75% of their box exactly
 *     as a room does.
 *   - only regions that a DETECTED WALL bounds. Notes panels pass it, because
 *     their cell lines are wall-shaped by every measure that matters.
 *   - the largest cluster of rooms connected by shared walls. The best of the
 *     three and still wrong: the margin joins the building's cluster THROUGH
 *     THE EXTERIOR WALL, which is a real wall separating two real spaces.
 *
 * ── AND WHY THE BOX IS A FIX RATHER THAN A WORKAROUND ──
 *
 * Cropping does not merely hide the margin, it removes the category. The grid
 * is built over the box alone, so the paper around the building now REACHES THE
 * EDGE of the grid and `regionsOf` marks it `open` — which this file already
 * excludes, and which `rooms.ts` already documents as "the paper AROUND the
 * drawing rather than a space inside it". No threshold, no new rule, no
 * tunable: the thing that was indistinguishable stops being a candidate.
 *
 * Inside a box the rooms are right. Measured on Augusta p11: 95 regions, each
 * office its own, the corridor correctly one run, boundaries on the walls, the
 * hatched existing building correctly yielding nothing.
 *
 * ── THE BOUND THIS SHIPS WITH, STATED RATHER THAN HIDDEN ──
 *
 * `traceRing` returns the OUTER boundary. A column standing inside a room is a
 * hole in that region, and the outer ring includes it — so the polygon's area
 * is larger than the region's true cell count by the column. The number the
 * screen shows is the POLYGON's, never the cell count, so what an estimator
 * reads is what gets priced; `columnsIncluded` says when the two disagree by
 * more than a little, so a room with a stair core in it can be rejected rather
 * than silently over-measured.
 */

/** A text item's box, in the same page-width units as the strokes. */
export type TextBox = { x: number; y: number; width: number; height: number };

/**
 * Half a foot of slack round a text box, in page-width units.
 *
 * In FEET, converted — never a bare number. `wallsNotLettering` records why:
 * a literal `2` is two points to the server reader and TWO PAGE WIDTHS to the
 * viewer, which would put the whole drawing inside a text box and filter the
 * sheet away.
 */
const LETTER_PAD_FEET = 0.5;

/** Longer than this and it is not a glyph, whatever it sits on top of. */
const LETTER_FEET = 2;

/**
 * Strokes with the stroked LETTERING removed.
 *
 * ── WHY THIS EXISTS, AND THE NUMBER THAT JUSTIFIES IT ──
 *
 * A sheet whose glyphs are saved as line work carries an enormous number of
 * tiny strokes: West Herr p21 has **197,620**, against 23,351 on Augusta. Every
 * one of those outlines is ink on the grid, and ink carves regions — so a room
 * with a note in it comes back as a dozen slivers around the letters rather
 * than as a room.
 *
 * Measured against room tags printed on the sheet, with the name-and-number
 * test that makes a tag a room rather than a legend entry:
 *
 * | sheet | every stroke | lettering dropped |
 * | --- | --- | --- |
 * | **Augusta p11** (33 real room tags) | 64% | **79%** |
 * | West Herr p21 | 49% | 49% |
 *
 * Augusta is the sheet whose ground truth is clean — `JUDGE BIAS`,
 * `MECHANICAL`, `CONFERENCE`, `COUNSELOR` — and fifteen points there is worth
 * having. West Herr is unchanged, and its denominator is half equipment labels
 * (`FEC`, `SPACE`), so it is the weaker of the two readings rather than a
 * contradiction.
 *
 * ── AND WHAT IT IS NOT ──
 *
 * This is NOT the fix that makes room detection fit to use: 79% on one sheet is
 * not a number anybody should bid from, and the button stays off
 * (`takeoffRoomFinder.test.tsx`). It is one filter the wall finder has had all
 * along, measured and moved across.
 */
export function strokesNotLettering(
  segments: readonly StrokeSegment[],
  text: readonly TextBox[],
  feetPerUnit: number,
): StrokeSegment[] {
  if (text.length === 0 || !(feetPerUnit > 0)) return [...segments];
  const pad = LETTER_PAD_FEET / feetPerUnit;
  return segments.filter((segment) => {
    const feet = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) * feetPerUnit;
    // A LONG STROKE IS NEVER A GLYPH. A wall running behind a room tag must
    // survive, or the filter takes the room with the label.
    if (feet > LETTER_FEET) return true;
    const midX = (segment.x1 + segment.x2) / 2;
    const midY = (segment.y1 + segment.y2) / 2;
    return !text.some(
      (box) =>
        midX >= box.x - pad &&
        midX <= box.x + box.width + pad &&
        midY >= box.y - pad &&
        midY <= box.y + box.height + pad,
    );
  });
}

/** A room found inside the box, ready to become an AREA measurement. */
export type DetectedRoom = {
  /** Stable only within one detection run. */
  id: number;
  /** From the traced polygon — the same number the app will derive after it is
   *  saved, never the raster cell count, so the screen cannot promise one
   *  figure and the estimate line carry another. */
  squareFeet: number;
  /** Fraction of the sheet WIDTH, matching `TakeoffMeasurement.xs`. */
  xs: number[];
  /** Also relative to the sheet width, matching `TakeoffMeasurement.ys`. */
  ys: number[];
  /** How much bigger the traced polygon is than the region it came from, as a
   *  fraction — a room with a column or a stair core in it reads above zero. */
  columnsIncluded: number;
};

/** The box, in the same normalised units as a stored measurement. */
export type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * The outer boundary of one region, as a rectilinear ring in CELL corner
 * coordinates.
 *
 * Built from directed cell edges rather than by walking pixels: every boundary
 * edge of the region is emitted with a consistent orientation (region on the
 * left), and the edges are then chained end to start.
 *
 * ── THE TURN AT A PINCH IS THE WHOLE DIFFICULTY ──
 *
 * Two parts of a region that touch at a single CORNER give that corner four
 * boundary edges, and the first version of this took whichever had been
 * registered first. On Augusta p11 that produced rings with long diagonal
 * chords cutting straight across rooms — visible immediately when the
 * polygons were drawn over the sheet, and invisible to every test, because a
 * chord still has an area and still has corners.
 *
 * It is not cosmetic. `saveTakeoffMeasurement` REFUSES a self-intersecting
 * area ring (`ringSelfIntersects`), so a room traced that way cannot be
 * accepted at all — the feature would have shipped silently dropping rooms.
 *
 * So the chain always takes the SHARPEST RIGHT TURN available. With the region
 * on the left of every edge, turning right at a junction hugs the boundary it
 * arrived on and keeps the ring simple, which is the standard face-tracing
 * rule for a planar subdivision rather than anything invented here.
 */
export function traceRing(
  inside: (x: number, y: number) => boolean,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): { x: number; y: number }[] {
  type Edge = { fx: number; fy: number; tx: number; ty: number };
  const from = new Map<string, Edge[]>();
  const at = (x: number, y: number) => `${x},${y}`;
  const push = (fx: number, fy: number, tx: number, ty: number) => {
    const k = at(fx, fy);
    const list = from.get(k);
    const edge = { fx, fy, tx, ty };
    if (list) list.push(edge);
    else from.set(k, [edge]);
  };

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!inside(x, y)) continue;
      // Each boundary edge of the cell, oriented so the region is on the
      // RIGHT (screen axes: +y is down, so this traverses clockwise).
      if (!inside(x, y - 1)) push(x, y, x + 1, y);
      if (!inside(x + 1, y)) push(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) push(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) push(x, y + 1, x, y);
    }
  }

  const used = new Set<Edge>();
  let best: { x: number; y: number }[] = [];

  for (const [, edges] of from) {
    for (const first of edges) {
      if (used.has(first)) continue;
      const ring: { x: number; y: number }[] = [{ x: first.tx, y: first.ty }];
      used.add(first);
      let edge = first;
      // Bounded: a malformed chain stops rather than spinning, because an
      // infinite loop in a takeoff is worse than a gap.
      for (let guard = 0; guard < 4 * (maxX - minX + 2) * (maxY - minY + 2); guard += 1) {
        if (edge.tx === first.fx && edge.ty === first.fy) break;
        const outs = (from.get(at(edge.tx, edge.ty)) ?? []).filter((e) => !used.has(e));
        if (outs.length === 0) break;
        const dx = Math.sign(edge.tx - edge.fx);
        const dy = Math.sign(edge.ty - edge.fy);
        // SHARPEST RIGHT FIRST. With the region on the right of every edge,
        // turning right at a junction hugs the boundary already being walked
        // and keeps the ring simple; taking whichever edge happened to be
        // registered first is what put diagonal chords across rooms.
        const wants = [
          { x: -dy, y: dx },
          { x: dx, y: dy },
          { x: dy, y: -dx },
          { x: -dx, y: -dy },
        ];
        let pick: Edge | undefined;
        for (const want of wants) {
          pick = outs.find(
            (e) => Math.sign(e.tx - e.fx) === want.x && Math.sign(e.ty - e.fy) === want.y,
          );
          if (pick) break;
        }
        if (!pick) break;
        used.add(pick);
        ring.push({ x: pick.tx, y: pick.ty });
        edge = pick;
      }
      if (ring.length > best.length) best = ring;
    }
  }
  return best;
}

/**
 * The ring's corners, with the rasteriser's staircase removed.
 *
 * DROPPING EXACTLY-COLLINEAR POINTS IS NOT ENOUGH, and the measurement is the
 * argument: on Augusta p11 the first ten rooms came back with 406, 376, 184,
 * 114, 174, 869… corners. A real wall is never exactly axis-aligned once it is
 * rasterised, so its contour zigzags by a cell and almost nothing is collinear.
 * A 406-point room is slow to draw, bloats the stored polygon and reads as
 * wrong on screen.
 *
 * `straighten` is `skeleton.ts`'s Ramer-Douglas-Peucker, already written for
 * this exact problem on wall paths and already iterative rather than recursive.
 * It keeps its first and last point, so the ring is closed by repeating the
 * start and the duplicate dropped afterwards.
 *
 * `tolerance` is in CELLS. Two removes a one-cell staircase and preserves
 * anything bigger — at Augusta's 0.082 ft/cell that is a two-inch feature,
 * far below the smallest jog in a real room.
 */
export function ringCorners(ring: { x: number; y: number }[], tolerance: number): { x: number; y: number }[] {
  const plain = dropCollinear(ring);
  if (plain.length < 4) return plain;
  const closed = [...plain, plain[0]];
  const straightened = straighten({ xs: closed.map((p) => p.x), ys: closed.map((p) => p.y) }, tolerance);
  const out = straightened.xs.map((x, i) => ({ x, y: straightened.ys[i] }));
  // `straighten` keeps the last point, which is the repeated first one.
  if (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) out.pop();
  return dropCollinear(out);
}

/** Drop points that sit on the straight line between their neighbours. A
 *  rectangular room becomes four points instead of several thousand. */
export function dropCollinear(ring: { x: number; y: number }[]): { x: number; y: number }[] {
  if (ring.length < 3) return ring;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[(i - 1 + ring.length) % ring.length];
    const b = ring[i];
    const c = ring[(i + 1) % ring.length];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (cross !== 0) out.push(b);
  }
  return out;
}

/** The area of a ring, in whatever units its points are in. */
function ringArea(ring: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Which regions in a grid are rooms: enclosed, big enough to stand in, not
 *  wall-shaped, and bounded by something the wall finder calls a wall. */
export function roomRegionIds(grid: RoomGrid): Set<number> {
  const sqft = grid.feetPerCell ** 2;
  const bounded = new Set<number>();
  for (const wall of wallsFromRooms(grid)) for (const id of wall.separates) bounded.add(id);

  const ids = new Set<number>();
  for (const region of grid.regions) {
    // `open` is the paper around the drawing. Inside a cropped box that is
    // exactly the margin, which is why the box removes it for free.
    if (region.open) continue;
    if (!bounded.has(region.id)) continue;
    // `separates` can name a thin region when it is a neighbour of some other
    // wall, so the wall-shape test still has to run.
    if (region.minor * grid.feetPerCell * 12 <= WIDEST_WALL_INCHES) continue;
    if (region.area * sqft < SMALLEST_ROOM_SQFT) continue;
    ids.add(region.id);
  }
  return ids;
}

/**
 * The rooms inside a box drawn on a sheet.
 *
 * `box` and the returned polygons are in stored-measurement units: x as a
 * fraction of the sheet width, y relative to that same width.
 */
export function roomsInBox(
  segments: readonly StrokeSegment[],
  widthPt: number,
  heightPt: number,
  feetPerPoint: number,
  box: Box,
  gridCap?: number,
): DetectedRoom[] {
  if (!(feetPerPoint > 0) || segments.length === 0) return [];
  // Clamped to the sheet: a box dragged off the edge would otherwise build a
  // grid over paper that does not exist, and the empty margin it adds reaches
  // the grid edge — which is harmless but wastes the resolution the thinnest
  // wall needs.
  const x0 = Math.max(0, Math.min(box.x0, box.x1) * widthPt);
  const x1 = Math.min(widthPt, Math.max(box.x0, box.x1) * widthPt);
  const y0 = Math.max(0, Math.min(box.y0, box.y1) * widthPt);
  const y1 = Math.min(heightPt, Math.max(box.y0, box.y1) * widthPt);
  const boxW = x1 - x0;
  const boxH = y1 - y0;
  if (!(boxW > 0) || !(boxH > 0)) return [];

  // Only the strokes the box contains, moved so the box's own corner is the
  // origin. A segment crossing the edge is kept whole: clipping it would open
  // a room that the sheet draws closed, and an open room floods into the
  // margin — the exact failure the box exists to prevent.
  const inBox = segments.filter(
    (s) =>
      Math.max(s.x1, s.x2) >= x0 &&
      Math.min(s.x1, s.x2) <= x1 &&
      Math.max(s.y1, s.y2) >= y0 &&
      Math.min(s.y1, s.y2) <= y1,
  );
  if (inBox.length === 0) return [];
  const moved = inBox.map((s) => ({ x1: s.x1 - x0, y1: s.y1 - y0, x2: s.x2 - x0, y2: s.y2 - y0 }));

  // Seal door openings first, exactly as the wall path does: an unsealed
  // doorway merges two rooms into one region.
  const seals = openingsInWalls(moved, feetPerPoint);
  const grid = roomGrid(
    [...moved, ...seals.map((o) => ({ x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 }))],
    boxW,
    boxH,
    feetPerPoint,
    gridCap,
  );
  if (grid.regions.length === 0) return [];

  const wanted = roomRegionIds(grid);
  if (wanted.size === 0) return [];

  const sqftPerCell = grid.feetPerCell ** 2;
  const ptPerCellX = boxW / grid.width;
  const ptPerCellY = boxH / grid.height;
  const rooms: DetectedRoom[] = [];

  for (const region of grid.regions) {
    if (!wanted.has(region.id)) continue;
    const ring = ringCorners(
      traceRing(
        (x, y) =>
          x >= 0 &&
          y >= 0 &&
          x < grid.width &&
          y < grid.height &&
          grid.label[y * grid.width + x] === region.id,
        region.minX,
        region.minY,
        region.maxX,
        region.maxY,
      ),
      RING_TOLERANCE_CELLS,
    );
    if (ring.length < 3) continue;

    // Back to page points, then to the stored fraction-of-width units.
    const xs = ring.map((p) => (x0 + p.x * ptPerCellX) / widthPt);
    const ys = ring.map((p) => (y0 + p.y * ptPerCellY) / widthPt);
    const squareFeet = ringArea(ring.map((p) => ({ x: p.x * ptPerCellX, y: p.y * ptPerCellY }))) * feetPerPoint ** 2;
    if (squareFeet < SMALLEST_ROOM_SQFT) continue;

    const cellArea = region.area * sqftPerCell;
    rooms.push({
      id: region.id,
      squareFeet: Math.round(squareFeet * 100) / 100,
      xs,
      ys,
      columnsIncluded: cellArea > 0 ? Math.max(0, (squareFeet - cellArea) / cellArea) : 0,
    });
  }

  return rooms.sort((a, b) => b.squareFeet - a.squareFeet);
}

/** Cells of slack when straightening a room's outline. Two removes the
 *  one-cell staircase a rasterised wall leaves and keeps everything real. */
export const RING_TOLERANCE_CELLS = 2;

/** Rooms whose traced polygon is meaningfully bigger than the space it came
 *  from — a column, a stair core or a shaft stands inside them. */
export const COLUMN_NOTICE = 0.05;
