import { BOX_TITLE, HEADING_SIZE } from "./legendBoxes";
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
  /** Every tag in a region that holds more than one, for a caller that can still use them. */
  sharedTags?: RoomTag[];
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

/**
 * ── A SIDELIGHT IS DRAWN, AND IT BRIDGES TWO WALL ENDS ──
 *
 * Joplin A-101 (2026-10-22): each resident room's corridor side is a door
 * plus a glazed sidelight between the two partition ends — no collinear wall
 * on either side of the gap, so `openingsInWalls` has nothing to anchor on
 * and the corner rule is off. But the sidelight is DRAWN: its glazing lines
 * run from the door jamb to the partition's corner. A stroke at least
 * `BRIDGE_MIN_FEET` long whose BOTH ends sit within `BRIDGE_REACH_FEET` of a
 * wall END, and which does not lie along a wall it merely duplicates, is a
 * bridge and is drawn as a thin band. Once it is, the door beside it is a
 * door-sized gap with wall on each side again, and the door rule seals it.
 *
 * Wall ENDS, not wall bodies, on purpose: a counter touches the walls either
 * side of it mid-wall, a sidelight continues a wall line from one end to
 * another. Measured with the BIM arm as the control.
 *
 * AND THE DOOR BESIDE THE SIDELIGHT IS HINGED IN THE CORNER, so the door rule
 * still has no collinear wall on its far side. The corner rule was measured
 * off as a default (it splits open plans); here it is applied ONLY from a
 * bridge's end: along the bridge's own line, up to one door's width, to the
 * first wall it meets. A drawn sidelight is the evidence that this gap is a
 * doorway and not a cased opening.
 */
export const BRIDGE_MIN_FEET = 2;
export const BRIDGE_REACH_FEET = 0.75;
export const BRIDGE_DOOR_FEET = 4.5;
const BRIDGE_BAND_FEET = 0.2;

export function bridgingLines(
  strokes: readonly { x1: number; y1: number; x2: number; y2: number }[],
  walls: readonly FoundWall[],
  feetPerUnit: number,
): FoundWall[] {
  const reach = BRIDGE_REACH_FEET / feetPerUnit;
  const minLen = BRIDGE_MIN_FEET / feetPerUnit;
  const ends = walls.flatMap((w) => [
    { x: w.x1, y: w.y1 },
    { x: w.x2, y: w.y2 },
  ]);
  const nearAnEnd = (x: number, y: number) => ends.some((e) => Math.hypot(e.x - x, e.y - y) <= reach);
  // A sidelight CONTINUES the wall whose end it touches: same line, within
  // 10°. A door leaf, a counter return or a fixture edge leaves a wall end at
  // an angle and must not bridge — the first BIM run without this test lost
  // 47 rooms past 5% to in-room lines hung off wall ends.
  const continuesAWall = (s: { x1: number; y1: number; x2: number; y2: number }) => {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const ux = (s.x2 - s.x1) / len;
    const uy = (s.y2 - s.y1) / len;
    return walls.some((w) => {
      const wl = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      if (!(wl > 0)) return false;
      const cos = Math.abs(((w.x2 - w.x1) / wl) * ux + ((w.y2 - w.y1) / wl) * uy);
      if (cos < Math.cos((10 * Math.PI) / 180)) return false;
      const endNear = (x: number, y: number) => Math.hypot(w.x1 - x, w.y1 - y) <= reach || Math.hypot(w.x2 - x, w.y2 - y) <= reach;
      return endNear(s.x1, s.y1) || endNear(s.x2, s.y2);
    });
  };
  const alongAWall = (s: { x1: number; y1: number; x2: number; y2: number }) => {
    const mx = (s.x1 + s.x2) / 2;
    const my = (s.y1 + s.y2) / 2;
    return walls.some((w) => {
      const dx = w.x2 - w.x1;
      const dy = w.y2 - w.y1;
      const len2 = dx * dx + dy * dy;
      if (!(len2 > 0)) return false;
      const t = Math.max(0, Math.min(1, ((mx - w.x1) * dx + (my - w.y1) * dy) / len2));
      const half = (w.thicknessFeet ?? DEFAULT_THICKNESS_FEET) / feetPerUnit / 2;
      return Math.hypot(mx - (w.x1 + t * dx), my - (w.y1 + t * dy)) <= half + reach;
    });
  };
  // One end at a wall END (the partition's corner); the other end is the door
  // jamb, which on Joplin is a 4-inch stub the boundary never carries, so it
  // is not required to touch anything — the door probe below starts there.
  const out: { b: FoundWall; probeFrom: 1 | 2 | null }[] = [];
  for (const s of strokes) {
    if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < minLen) continue;
    const at1 = nearAnEnd(s.x1, s.y1);
    const at2 = nearAnEnd(s.x2, s.y2);
    if (!at1 && !at2) continue;
    if (!continuesAWall(s)) continue;
    if (alongAWall(s)) continue;
    out.push({ b: { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, thicknessFeet: BRIDGE_BAND_FEET }, probeFrom: at1 && at2 ? null : at1 ? 2 : 1 });
  }
  // The door beside each bridge: from either end of the bridge, along its own
  // line, to the first wall within a door's width.
  const door = BRIDGE_DOOR_FEET / feetPerUnit;
  const hit = (x: number, y: number, dx: number, dy: number): number | null => {
    let best: number | null = null;
    for (const w of walls) {
      const wx = w.x2 - w.x1;
      const wy = w.y2 - w.y1;
      const denom = dx * wy - dy * wx;
      if (Math.abs(denom) < 1e-12) continue;
      const rx = w.x1 - x;
      const ry = w.y1 - y;
      const t = (rx * wy - ry * wx) / denom;
      const u = (rx * dy - ry * dx) / denom;
      const half = (w.thicknessFeet ?? DEFAULT_THICKNESS_FEET) / feetPerUnit / 2;
      const wlen = Math.hypot(wx, wy);
      if (t <= reach || t > door) continue;
      if (u * wlen < -half || u * wlen > wlen + half) continue;
      if (best === null || t < best) best = t;
    }
    return best;
  };
  // Probed ONLY from the free end: from a corner the same probe would cross a
  // 4-ft corridor and seal it.
  // AND THE PATTERN HAS TO COMPLETE: a bridge with a free end is kept only
  // when the door probe from that end reaches a wall. A collinear line off a
  // wall end that leads nowhere is casework or a fixture, not a sidelight —
  // the second BIM run (collinear, no completion) still lost 26 rooms past 5%
  // to those, concentrated on the clinic's dense interiors.
  const kept: FoundWall[] = [];
  const seals: FoundWall[] = [];
  for (const { b, probeFrom } of out) {
    if (probeFrom === null) {
      kept.push(b);
      continue;
    }
    const len = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
    const ux = (b.x2 - b.x1) / len;
    const uy = (b.y2 - b.y1) / len;
    const [ex, ey, dx, dy] = probeFrom === 2 ? [b.x2, b.y2, ux, uy] : [b.x1, b.y1, -ux, -uy];
    const t = hit(ex, ey, dx, dy);
    if (t === null) continue;
    kept.push(b);
    seals.push({ x1: ex, y1: ey, x2: ex + dx * t, y2: ey + dy * t, thicknessFeet: BRIDGE_BAND_FEET });
  }
  return [...kept, ...seals];
}

export function roomsFromWalls(input: {
  walls: readonly FoundWall[];
  /** Feet per page-width unit. */
  feetPerUnit: number;
  /** The sheet's strokes, page-width units, for `bridgingLines`. Read only
   *  with `bridgeSidelights` on. */
  strokes?: readonly { x1: number; y1: number; x2: number; y2: number }[];
  /** Seal door-plus-sidelight openings from the drawn glazing (`bridgingLines`).
   *  OFF by default — measured 2026-10-22: it closes real-sheet leaks (Bunkie
   *  A100 4 → 6 rooms measured) and costs the BIM arm 9 rooms past 5%
   *  (454 → 445 of 713); see NOTES-rooms.md §11 for the three versions tried. */
  bridgeSidelights?: boolean;
  /** The page's text, in points, for the tags. */
  text?: readonly PositionedText[];
  widthPt?: number;
  gridCap?: number;
  /** Also seal corner-hinged doors. Off by default — measured, see `cornerSeals`. */
  sealCornerDoors?: boolean;
  /**
   * The doors read off the sheet's own swing symbols (`doorWindowSymbols.ts`),
   * each as the leaf's line hinge → strike, page-width units. Drawn as ink so
   * the doorway closes exactly where the door is, with the door's own width,
   * instead of where `openingsInWalls` infers a gap. Measured 2026-10-29, see
   * NOTES-doors.md §5.
   */
  doorSeals?: readonly { x1: number; y1: number; x2: number; y2: number }[];
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
  if (input.bridgeSidelights && input.strokes) walls.push(...bridgingLines(input.strokes, walls, feetPerUnit));

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
  for (const d of input.doorSeals ?? []) bands.push({ x1: d.x1 - x0, y1: d.y1 - y0, x2: d.x2 - x0, y2: d.y2 - y0 });
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
  const tagged = new Set<RoomFromWalls>();
  if (input.text && input.widthPt) {
    const w = input.widthPt;
    const tagsOfRoom = new Map<RoomFromWalls, RoomTag[]>();
    for (const tag of readRoomTags(input.text)) {
      const placed = { ...tag, x: tag.x / w, y: tag.y / w, numberAt: tag.numberAt && { x: tag.numberAt.x / w, y: tag.numberAt.y / w } };
      const roomAt = (at: { x: number; y: number }) => {
        const cx = Math.floor((at.x - x0) / unitsPerCellX);
        const cy = Math.floor((at.y - y0) / unitsPerCellY);
        const inside = cx >= 0 && cy >= 0 && cx < size.width && cy < size.height ? label[cy * size.width + cx] : -1;
        return inside >= 0 ? roomOfRegion.get(inside) : undefined;
      };
      const room = (placed.numberAt && roomAt(placed.numberAt)) ?? roomAt(placed);
      if (!room) {
        unplacedTags.push(placed);
        continue;
      }
      const list = tagsOfRoom.get(room);
      if (list) list.push(placed);
      else tagsOfRoom.set(room, [placed]);
    }
    for (const [room, tags] of tagsOfRoom) {
      tagged.add(room);
      if (tags.length === 1) room.tag = tags[0];
      else {
        room.sharedTags = tags;
        mergedTags.push(...tags);
      }
    }
  }
  return { rooms: withoutFramedText(rooms, tagged, input.text, input.widthPt, (x, y) => {
    const cx = Math.floor((x - x0) / unitsPerCellX), cy = Math.floor((y - y0) / unitsPerCellY);
    const inside = cx >= 0 && cy >= 0 && cx < size.width && cy < size.height ? label[cy * size.width + cx] : -1;
    return inside >= 0 ? roomOfRegion.get(inside) : undefined;
  }), unplacedTags, mergedTags, grid: size };
}

/**
 * A framed legend or notes block closes like a room. Same test as
 * `legendBoxes.ts`, a title in heading type, and only on a region no room tag
 * names: Joplin A-101's GENERAL PLAN NOTES came back as a 2,321 sf room.
 */
function withoutFramedText(rooms: RoomFromWalls[], tagged: ReadonlySet<RoomFromWalls>, text: readonly PositionedText[] | undefined, widthPt: number | undefined, roomAt: (x: number, y: number) => RoomFromWalls | undefined): RoomFromWalls[] {
  if (!text || !widthPt || text.length === 0) return rooms;
  const heights = text.map((t) => t.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)]!;
  const framed = new Set<RoomFromWalls>();
  for (const t of text) {
    if (t.height < HEADING_SIZE * median || !BOX_TITLE.test(t.str)) continue;
    const room = roomAt((t.x + t.width / 2) / widthPt, t.y / widthPt);
    if (room && !tagged.has(room)) framed.add(room);
  }
  return framed.size === 0 ? rooms : rooms.filter((r) => !framed.has(r));
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

/** A line this long, feet, can be the wall a leaked region is missing. At 3 and 5, casework shredded rooms (Joplin 108 came out at 61 sf). */
export const SPLIT_LINE_FEET = 8;
/** The parts of a split must keep this share of the region's area, or the lines shredded it. */
const SPLIT_KEEPS_AREA = 0.7;
/** An unnamed piece of a split smaller than this is casework between the walls, not a room. */
const SPLIT_LEFTOVER_SQFT = 100;
/** An unnamed region smaller than this is a chase. It has no schedule row and only adds a blank row to the list. */
const SMALLEST_UNNAMED_SQFT = 20;
/** An open room's tag names an unnamed room this close, feet. */
export const ADJACENT_TAG_FEET = 4;

function insidePolygon(x: number, y: number, xs: readonly number[], ys: readonly number[]): boolean {
  let hit = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i, i += 1) {
    if (ys[i]! > y !== ys[j]! > y && x < ((xs[j]! - xs[i]!) * (y - ys[i]!)) / (ys[j]! - ys[i]!) + xs[i]!) hit = !hit;
  }
  return hit;
}

function distanceToRing(x: number, y: number, xs: readonly number[], ys: readonly number[]): number {
  let best = Infinity;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i, i += 1) {
    const dx = xs[i]! - xs[j]!, dy = ys[i]! - ys[j]!, q = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - xs[j]!) * dx + (y - ys[j]!) * dy) / q));
    best = Math.min(best, Math.hypot(x - xs[j]! - t * dx, y - ys[j]! - t * dy));
  }
  return best;
}

/**
 * ── A LEAKED REGION, SPLIT WHERE THE SHEET DRAWS THE WALL ──
 *
 * A region holding two room tags is two rooms the walls did not close. Baker's
 * and Joplin's found walls miss a run here and there, and the sheet's own lines
 * are usually there. Adding every long line everywhere is no answer: Joplin
 * grew a 17,153 sf "room" outside the building. So the lines and the door leaves
 * are only believed inside a region that already proves it is several rooms,
 * and a split stands only if it puts the tags in different parts and keeps most
 * of the area. Anything else stays one region, and says so.
 */
export function roomsSplitAtDrawnWalls(
  input: Parameters<typeof roomsFromWalls>[0],
  lines: readonly { x1: number; y1: number; x2: number; y2: number }[],
): RoomsFromWallsResult {
  const first = roomsFromWalls(input);
  const leaked = first.rooms.filter((r) => r.sharedTags);
  let rooms = first.rooms;
  if (leaked.length > 0) {
    const reach = SPLIT_LINE_FEET / input.feetPerUnit;
    const extra = lines.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= reach).map((s) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, thicknessFeet: 2 / 12 }));
    const second = roomsFromWalls({ ...input, walls: [...input.walls, ...extra], sealCornerDoors: true });
    const slack = 1 / input.feetPerUnit;
    for (const region of leaked) {
      // Wholly inside: the outside of a building can have its middle in a room.
      const parts = second.rooms.filter((r) => r.xs.every((x, i) => insidePolygon(x, r.ys[i]!, region.xs, region.ys) || distanceToRing(x, r.ys[i]!, region.xs, region.ys) <= slack));
      const named = parts.filter((p) => p.tag !== null || p.sharedTags);
      const kept = parts.reduce((a, p) => a + p.squareFeet, 0);
      if (named.length < 2 || kept < SPLIT_KEEPS_AREA * region.squareFeet) continue;
      rooms = [...rooms.filter((r) => r !== region), ...parts.filter((p) => p.tag !== null || p.sharedTags || p.squareFeet >= SPLIT_LEFTOVER_SQFT)];
    }
  }
  const out = rooms.filter((r) => r.tag !== null || r.sharedTags || r.squareFeet >= SMALLEST_UNNAMED_SQFT).map((r, id) => ({ ...r, id }));
  // A tag in no closed region, beside a room nothing names, is that room's.
  const unplacedTags: RoomTag[] = [];
  const claimed = new Map<RoomFromWalls, RoomTag | null>();
  for (const tag of first.unplacedTags) {
    const at = tag.numberAt ?? tag;
    const near = out.filter((r) => r.tag === null && !r.sharedTags).map((r) => ({ r, d: distanceToRing(at.x, at.y, r.xs, r.ys) * input.feetPerUnit })).filter((c) => c.d <= ADJACENT_TAG_FEET).sort((a, b) => a.d - b.d)[0];
    if (!near || claimed.has(near.r)) {
      if (near) claimed.set(near.r, null);
      unplacedTags.push(tag);
      continue;
    }
    claimed.set(near.r, tag);
  }
  for (const [room, tag] of claimed) {
    if (tag) room.tag = tag;
  }
  const mergedTags = out.flatMap((r) => r.sharedTags ?? []);
  return { ...first, rooms: out, unplacedTags, mergedTags };
}

/** Drawn lines this long may close a room. Shorter and thin is a stall partition to the engine anyway. */
export const CLOSE_LINE_FEET = STALL_LENGTH_FEET;
export const CLOSE_LARGEST_SQFT = 3000;
/** Measured: 0.6 kept every clear room and dropped all but one stamp and notes box. */
export const CLOSE_WALL_SHARE = 0.6;
/** Letters in a room's name: drops `REF.`, the one that got past the share. */
export const CLOSE_NAME_LETTERS = 4;
const ON_WALL_FEET = 1;
const RING_STEP_FEET = 1;

/** How much of a room's outline runs along found walls, 0 to 1. */
export function shareOnWalls(room: Pick<RoomFromWalls, "xs" | "ys">, walls: readonly FoundWall[], feetPerUnit: number): number {
  let on = 0;
  let all = 0;
  const n = room.xs.length;
  for (let i = 0; i < n; i += 1) {
    const x1 = room.xs[i]!, y1 = room.ys[i]!, x2 = room.xs[(i + 1) % n]!, y2 = room.ys[(i + 1) % n]!;
    const steps = Math.ceil((Math.hypot(x2 - x1, y2 - y1) * feetPerUnit) / RING_STEP_FEET);
    for (let k = 0; k < steps; k += 1) {
      const x = x1 + ((x2 - x1) * (k + 0.5)) / steps, y = y1 + ((y2 - y1) * (k + 0.5)) / steps;
      all += 1;
      const near = walls.some((w) => {
        const dx = w.x2 - w.x1, dy = w.y2 - w.y1, q = dx * dx + dy * dy || 1e-12;
        const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / q));
        return Math.hypot(x - w.x1 - t * dx, y - w.y1 - t * dy) * feetPerUnit <= ON_WALL_FEET + (w.thicknessFeet ?? DEFAULT_THICKNESS_FEET) / 2;
      });
      if (near) on += 1;
    }
  }
  return all === 0 ? 0 : on / all;
}

/**
 * ── AN OPEN ROOM, CLOSED AGAINST WHAT THE SHEET DRAWS ──
 *
 * A new room often closes against an existing wall, drawn in grey. That wall
 * is rightly not in the takeoff, so the found walls leave the room open. Only
 * a tag still open may use the drawn lines, and only if it lands alone in a
 * region of room size whose outline runs mostly along found walls: a stamp or a
 * notes box is enclosed by rules too, and printed tags read as room names. Added
 * lines can only divide open space, so a closed room cannot change.
 */
export function roomsClosedAtDrawnLines(
  result: RoomsFromWallsResult,
  input: Parameters<typeof roomsFromWalls>[0],
  lines: readonly { x1: number; y1: number; x2: number; y2: number }[],
): RoomsFromWallsResult {
  const named = result.unplacedTags.filter((t) => t.name.replace(/[^A-Za-z]/g, "").length >= CLOSE_NAME_LETTERS);
  if (named.length === 0) return result;
  const reach = CLOSE_LINE_FEET / input.feetPerUnit;
  const extra = lines.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= reach).map((s) => ({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, thicknessFeet: 0.1 }));
  const second = roomsFromWalls({ ...input, walls: [...input.walls, ...extra] });
  const closed = named.flatMap((tag) => {
    const room = second.rooms.find((r) => r.tag !== null && r.tag.x === tag.x && r.tag.y === tag.y);
    if (room === undefined || room.squareFeet > CLOSE_LARGEST_SQFT) return [];
    return shareOnWalls(room, input.walls, input.feetPerUnit) < CLOSE_WALL_SHARE ? [] : [room];
  });
  const now = new Set(closed.map((r) => r.tag));
  const rooms = [...result.rooms, ...closed].map((r, id) => ({ ...r, id }));
  return { ...result, rooms, unplacedTags: result.unplacedTags.filter((t) => ![...now].some((c) => c !== null && c.x === t.x && c.y === t.y)) };
}
