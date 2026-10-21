import { openingsInWalls } from "./openings";
import { ringCorners, RING_TOLERANCE_CELLS, traceRing } from "./roomAreas";
import { readRoomTags, type PositionedText, type RoomTag } from "./roomTags";
import { gridSizeFor, rasterise, regionsOf, SMALLEST_ROOM_SQFT } from "./rooms";

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
 *      `openingsInWalls`, so a doorway does not merge two rooms into one;
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
}): RoomsFromWallsResult {
  const { walls, feetPerUnit } = input;
  const empty = { rooms: [], unplacedTags: [], mergedTags: [], grid: { width: 0, height: 0, feetPerCell: 0 } };
  if (!(feetPerUnit > 0) || walls.length === 0) return empty;

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
