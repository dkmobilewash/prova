import { NARROWEST_DOOR_FEET, openingsInWalls } from "./openings";
import { ringCorners, RING_TOLERANCE_CELLS, traceRing } from "./roomAreas";
import { readRoomTags, type PositionedText, type RoomTag } from "./roomTags";
import { gridSizeFor, rasterise, regionsOf, SMALLEST_ROOM_SQFT } from "./rooms";
import { wallsNotLettering } from "./wallVectors";

/**
 * ── ROOMS FROM THE WALLS THAT WERE FOUND, NOT FROM EVERY STROKE ──
 *
 * `roomAreas.ts` is switched off because it rasterises the whole sheet: a
 * leader cuts a room in half, a dimension string encloses a region of its
 * own, a parked car is a room. Its ring geometry is right; what reaches it is
 * wrong. This feeds the ring geometry WALLS — the finder's accepted runs and
 * the reviewer's traces, which have already had the leaders, dimensions and
 * furniture judged out of them — and nothing else:
 *
 *   1. each wall is drawn as a filled band of its own thickness, extended by
 *      half that thickness at each end so a run that stops at a neighbour's
 *      FACE still meets the neighbour's body (that is where the finder's
 *      centrelines stop);
 *   2. door-sized gaps between collinear walls are sealed by
 *      `openingsInWalls`, so a doorway does not merge two rooms into one.
 *      A door hinged IN A CORNER — wall on one side of the gap only — is NOT
 *      sealed by default: `cornerSeals` exists and is measured OFF, see its
 *      header. The crops (shots/rooms, 2026-10-21) show Bunkie's E100, SW's
 *      restroom and alcove leaking through exactly such a corner, and the
 *      rule that closes them costs more rooms than it saves;
 *   3. the enclosed regions are traced into polygons (`traceRing`,
 *      `ringCorners`), measured in square feet and feet of perimeter;
 *   4. the room tag whose position lands inside a region names it
 *      (`readRoomTags`), and a tag in no region is reported, because a
 *      detector is judged by what it MISSES.
 *
 * Units: walls and the answer are in PAGE-WIDTH units, y from the top — what
 * the label files and `TakeoffMeasurement` use. Text comes in points as
 * `pageText` gives it, with the page width to convert.
 *
 * Area is measured to the INSIDE FACE of the walls, which is what a printed
 * tag and an IFC space both report. The outside of the building touches the
 * grid edge, so it is `open` and never a room — the same mechanism
 * `roomAreas.ts` documents for the box.
 */

export type FoundWall = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Feet. A traced wall has none; it is drawn `DEFAULT_THICKNESS_FEET` wide. */
  thicknessFeet?: number;
};

export type RoomFromWalls = {
  id: number;
  squareFeet: number;
  perimeterFeet: number;
  /** The polygon, page-width units. */
  xs: number[];
  ys: number[];
  /** The ONE tag found inside, with `x`/`y` in page-width units. Null when
   *  none landed here — or when more than one did, which means two rooms
   *  have leaked into each other; those tags are in `mergedTags`. */
  tag: RoomTag | null;
};

export type RoomsFromWallsResult = {
  rooms: RoomFromWalls[];
  /** Tags that landed on no closed region: the room is open to the outside. */
  unplacedTags: RoomTag[];
  /** Tags that shared a region with another tag: two rooms read as one. */
  mergedTags: RoomTag[];
  grid: { width: number; height: number; feetPerCell: number };
};

/** A traced wall carries no thickness; 4-7/8in is the common stud partition. */
export const DEFAULT_THICKNESS_FEET = 0.40625;

/**
 * ── A TOILET PARTITION IS NOT A ROOM BOUNDARY ──
 *
 * Camp Clark's shower rooms (2026-10-22) closed at 184 sf against 375
 * printed: the stall partitions — 1-inch panels, four or five feet long,
 * drawn as pairs — cut each room in half. A wall is at least 2-1/2 in thick
 * (`THINNEST_WALL_FEET` in rooms.ts, a furring wall); a stall panel is one
 * inch, and nothing one inch thick and shorter than a stall run encloses a
 * room. Both bounds are in FEET of building, so they hold at every scale.
 */
export const STALL_THICKNESS_FEET = 0.15;
export const STALL_LENGTH_FEET = 7;

export function notStallPartition(w: FoundWall, feetPerUnit: number): boolean {
  if (w.thicknessFeet === undefined || w.thicknessFeet >= STALL_THICKNESS_FEET) return true;
  return Math.hypot(w.x2 - w.x1, w.y2 - w.y1) * feetPerUnit >= STALL_LENGTH_FEET;
}

/** Paper left around the walls so the outside is open, in feet. */
const MARGIN_FEET = 2;

export function roomsFromWalls(input: {
  walls: readonly FoundWall[];
  /** Feet per page-width unit. */
  feetPerUnit: number;
  /** The page's text, in points, for the tags. */
  text?: readonly PositionedText[];
  widthPt?: number;
  gridCap?: number;
  /** Also seal corner-hinged doors. Off by default — measured, see `cornerSeals`. */
  sealCornerDoors?: boolean;
}): RoomsFromWallsResult {
  const { feetPerUnit } = input;
  const empty = { rooms: [], unplacedTags: [], mergedTags: [], grid: { width: 0, height: 0, feetPerCell: 0 } };
  if (!(feetPerUnit > 0) || input.walls.length === 0) return empty;

  // A tag's own box — the rectangle drawn round `E102` — pairs as a short
  // wall, and a short wall round a tag puts the tag in a region too small to
  // be a room. Measured on Bunkie A100 (2026-10-21): with the finder's raw
  // pairings in, rooms the offered set had closed came back OPEN, because the
  // tag sat in its own little box. The finder's own lettering rule removes it.
  const walls: FoundWall[] = (
    input.text && input.widthPt
      ? wallsNotLettering(
          input.walls.map((w) => ({
            ...w,
            thicknessFeet: w.thicknessFeet ?? DEFAULT_THICKNESS_FEET,
            lengthFeet: Math.hypot(w.x2 - w.x1, w.y2 - w.y1) * feetPerUnit,
          })),
          input.text.map((t) => ({
            x: t.x / (input.widthPt as number),
            y: t.y / (input.widthPt as number),
            width: t.width / (input.widthPt as number),
            height: t.height / (input.widthPt as number),
          })),
          feetPerUnit,
        )
      : [...input.walls]
  ).filter((w) => notStallPartition(w, feetPerUnit));
  if (walls.length === 0) return empty;

  const margin = MARGIN_FEET / feetPerUnit;
  const xs = walls.flatMap((w) => [w.x1, w.x2]);
  const ys = walls.flatMap((w) => [w.y1, w.y2]);
  const x0 = Math.min(...xs) - margin;
  const y0 = Math.min(...ys) - margin;
  const boxW = Math.max(...xs) + margin - x0;
  const boxH = Math.max(...ys) + margin - y0;
  if (!(boxW > 0) || !(boxH > 0)) return empty;

  const size = gridSizeFor(boxW, boxH, feetPerUnit, input.gridCap);
  const unitsPerCellX = boxW / size.width;
  const unitsPerCellY = boxH / size.height;
  const cell = Math.max(unitsPerCellX, unitsPerCellY);

  // 1. walls as bands
  const bands: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const w of walls) {
    const t = (w.thicknessFeet ?? DEFAULT_THICKNESS_FEET) / feetPerUnit;
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) continue;
    const ux = dx / len;
    const uy = dy / len;
    const ext = t / 2;
    const ax = w.x1 - x0 - ux * ext;
    const ay = w.y1 - y0 - uy * ext;
    const bx = w.x2 - x0 + ux * ext;
    const by = w.y2 - y0 + uy * ext;
    const steps = Math.max(1, Math.ceil(t / cell));
    for (let k = 0; k <= steps; k += 1) {
      const off = -t / 2 + (t * k) / steps;
      bands.push({ x1: ax - uy * off, y1: ay + ux * off, x2: bx - uy * off, y2: by + ux * off });
    }
  }
  // 2. door seals. `openingsInWalls` was written for FACE lines — it only
  // seals a gap on a line that has a partner face a wall's thickness away —
  // so each centreline is handed over as its two faces.
  const faces: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const w of walls) {
    const t = (w.thicknessFeet ?? DEFAULT_THICKNESS_FEET) / feetPerUnit;
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    if (!(len > 0)) continue;
    const nx = (-(w.y2 - w.y1) / len) * (t / 2);
    const ny = ((w.x2 - w.x1) / len) * (t / 2);
    for (const sign of [1, -1]) {
      faces.push({ x1: w.x1 - x0 + sign * nx, y1: w.y1 - y0 + sign * ny, x2: w.x2 - x0 + sign * nx, y2: w.y2 - y0 + sign * ny });
    }
  }
  const seals = openingsInWalls(faces, feetPerUnit);
  for (const s of seals) bands.push({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 });
  if (input.sealCornerDoors) {
    for (const s of cornerSeals(walls.map((w) => ({ ...w, x1: w.x1 - x0, y1: w.y1 - y0, x2: w.x2 - x0, y2: w.y2 - y0 })), feetPerUnit)) bands.push(s);
  }

  const ink = rasterise(bands, size.width, size.height, unitsPerCellX, unitsPerCellY);
  const regions = regionsOf(ink, size.width, size.height);
  const label = regions.label;
  const sqftPerCell = (unitsPerCellX * feetPerUnit) * (unitsPerCellY * feetPerUnit);

  // 3. polygons
  const rooms: RoomFromWalls[] = [];
  const roomOfRegion = new Map<number, RoomFromWalls>();
  for (const region of regions) {
    if (region.open) continue;
    if (region.area * sqftPerCell < SMALLEST_ROOM_SQFT) continue;
    const ring = ringCorners(
      traceRing(
        (x, y) => x >= 0 && y >= 0 && x < size.width && y < size.height && label[y * size.width + x] === region.id,
        region.minX,
        region.minY,
        region.maxX,
        region.maxY,
      ),
      RING_TOLERANCE_CELLS,
    );
    if (ring.length < 3) continue;
    const px = ring.map((p) => x0 + p.x * unitsPerCellX);
    const py = ring.map((p) => y0 + p.y * unitsPerCellY);
    let area = 0;
    let perimeter = 0;
    for (let i = 0; i < px.length; i += 1) {
      const j = (i + 1) % px.length;
      area += px[i] * py[j] - px[j] * py[i];
      perimeter += Math.hypot(px[j] - px[i], py[j] - py[i]);
    }
    const room: RoomFromWalls = {
      id: rooms.length,
      squareFeet: (Math.abs(area) / 2) * feetPerUnit * feetPerUnit,
      perimeterFeet: perimeter * feetPerUnit,
      xs: px,
      ys: py,
      tag: null,
    };
    rooms.push(room);
    roomOfRegion.set(region.id, room);
  }

  // 4. tags
  const unplacedTags: RoomTag[] = [];
  const mergedTags: RoomTag[] = [];
  if (input.text && input.widthPt) {
    const w = input.widthPt;
    const tagsOfRoom = new Map<RoomFromWalls, RoomTag[]>();
    for (const tag of readRoomTags(input.text)) {
      const placed = { ...tag, x: tag.x / w, y: tag.y / w };
      const cx = Math.floor((placed.x - x0) / unitsPerCellX);
      const cy = Math.floor((placed.y - y0) / unitsPerCellY);
      const inside = cx >= 0 && cy >= 0 && cx < size.width && cy < size.height ? label[cy * size.width + cx] : -1;
      const room = inside >= 0 ? roomOfRegion.get(inside) : undefined;
      if (!room) {
        unplacedTags.push(placed);
        continue;
      }
      const list = tagsOfRoom.get(room);
      if (list) list.push(placed);
      else tagsOfRoom.set(room, [placed]);
    }
    for (const [room, tags] of tagsOfRoom) {
      if (tags.length === 1) room.tag = tags[0];
      else mergedTags.push(...tags);
    }
  }
  return { rooms, unplacedTags, mergedTags, grid: size };
}

/**
 * ── A DOOR IN A CORNER ──
 *
 * `openingsInWalls` wants wall on BOTH sides of a gap, along one line. A door
 * hinged against a perpendicular wall has wall on one side only: the run
 * stops a door's width short of the wall it would otherwise meet. So for
 * every wall END, look straight ahead for a wall roughly perpendicular to it
 * that passes across the line of travel within a door's width, with nothing
 * collinear filling the gap — and draw the seal from the end to that face.
 *
 * A corridor meeting a cross wall does NOT look like this: its side walls
 * run INTO the through wall with no gap. A corridor crossing a room does not
 * either: the gap there is bounded by another wall END, not by a face it
 * would cross. Only a through wall standing across the line, door-width
 * away, qualifies.
 *
 * ── MEASURED, AND OFF BY DEFAULT ──
 *
 * 2026-10-21, BIM arm (the key's own walls, 713 tagged rooms), against the
 * default of no corner seal — 478 measured, median 1.2%, 438 within 5%,
 * 102 merged through a wall:
 *
 *   ceiling 12 ft (`WIDEST_DOOR_FEET`)   673 measured, median 6.9%, 329 within 5%, 6 merged
 *   ceiling 4.5 ft (one leaf + frame)    478 measured, median 1.2%, 390 within 5%, 102 merged
 *
 * The wide version closes the leaks by cutting open-plan rooms to pieces
 * (46 → 131 regions on one esplanades floor: kitchen returns, balcony walls,
 * a stub at a column). The narrow version closes almost nothing on the BIM
 * sheets and still splits 48 rooms past 5%. On the real sheets it closed
 * nothing either (Bunkie all-candidates 4 → 4 measured, SW 0 → 0). So it
 * stays available for a caller that KNOWS it has corner doors and is not
 * wired in — a rule that costs more rooms than it saves is not a default.
 */
export const CORNER_DOOR_MAX_FEET = 4.5;
/** The through wall must carry on at least this far past the hit on both
 *  sides, or it is a corner, not a face. */
const THROUGH_WALL_BEYOND_FEET = 1;
export function cornerSeals(walls: readonly FoundWall[], feetPerUnit: number): { x1: number; y1: number; x2: number; y2: number }[] {
  const narrowest = NARROWEST_DOOR_FEET / feetPerUnit;
  const widest = CORNER_DOOR_MAX_FEET / feetPerUnit;
  const beyond = THROUGH_WALL_BEYOND_FEET / feetPerUnit;
  const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const w of walls) {
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    if (!(len > 0)) continue;
    const ux = (w.x2 - w.x1) / len;
    const uy = (w.y2 - w.y1) / len;
    for (const [ex, ey, dx, dy] of [
      [w.x2, w.y2, ux, uy],
      [w.x1, w.y1, -ux, -uy],
    ] as const) {
      let best: { t: number; x: number; y: number } | null = null;
      for (const o of walls) {
        if (o === w) continue;
        const olen = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
        if (!(olen > 0)) continue;
        const ox = (o.x2 - o.x1) / olen;
        const oy = (o.y2 - o.y1) / olen;
        // roughly perpendicular
        if (Math.abs(ox * dx + oy * dy) > 0.25) continue;
        // where the ray from the end crosses o's line
        const denom = dx * oy - dy * ox;
        if (Math.abs(denom) < 1e-9) continue;
        const rx = o.x1 - ex;
        const ry = o.y1 - ey;
        const t = (rx * oy - ry * ox) / denom; // along the ray
        const s = (rx * dy - ry * dx) / denom; // along o, in units
        if (t < narrowest || t > widest) continue;
        // the through wall must extend on BOTH sides of the hit — a face, not an end
        if (s < beyond || s > olen - beyond) continue;
        if (!best || t < best.t) best = { t, x: ex + dx * t, y: ey + dy * t };
      }
      if (!best) continue;
      // nothing collinear already fills the gap
      const filled = walls.some((o) => {
        if (o === w) return false;
        const olen = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
        if (!(olen > 0)) return false;
        if (Math.abs(((o.x2 - o.x1) / olen) * dx + ((o.y2 - o.y1) / olen) * dy) < 0.97) return false;
        const mid = { x: ex + (dx * best!.t) / 2, y: ey + (dy * best!.t) / 2 };
        const px = ((mid.x - o.x1) * (o.x2 - o.x1) + (mid.y - o.y1) * (o.y2 - o.y1)) / (olen * olen);
        if (px < 0 || px > 1) return false;
        const cx = o.x1 + px * (o.x2 - o.x1);
        const cy = o.y1 + px * (o.y2 - o.y1);
        return Math.hypot(cx - mid.x, cy - mid.y) < narrowest / 2;
      });
      if (filled) continue;
      out.push({ x1: ex, y1: ey, x2: best.x, y2: best.y });
    }
  }
  return out;
}
