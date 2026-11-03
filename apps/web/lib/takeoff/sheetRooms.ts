import { roomBoundary } from "./roomBoundary";
import { roomSeals } from "./roomSeals";
import { roomsClosedAtDrawnLines, roomsSplitAtDrawnWalls, type RoomFromWalls, type RoomsFromWallsResult } from "./roomsFromWalls";
import { SMALLEST_ROOM_SQFT } from "./rooms";
import type { PositionedText, RoomTag } from "./roomTags";
import type { StrokeSegment } from "./wallVectors";
import { pointInRing } from "./drawTools";

type Line = { x1: number; y1: number; x2: number; y2: number };

/** How far past each end a split runs, feet, so a line stopped just short of a wall still meets it. */
const SPLIT_OVERRUN_FEET = 1;

function reachingWalls(line: Line, feetPerUnit: number): Line {
  const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1) || 1;
  const ux = ((line.x2 - line.x1) / length) * (SPLIT_OVERRUN_FEET / feetPerUnit), uy = ((line.y2 - line.y1) / length) * (SPLIT_OVERRUN_FEET / feetPerUnit);
  return { x1: line.x1 - ux, y1: line.y1 - uy, x2: line.x2 + ux, y2: line.y2 + uy };
}

/**
 * A sheet's rooms from what a Find left behind. The one path, so the viewer and
 * the whole-set run cannot disagree about a sheet: the boundary, the doors that
 * seal it, and the sheet's own lines for a region that leaked or a room left open. `segments` and
 * `doorLeaves` are in page-width units, and empty when no Find has read them.
 */
export function sheetRooms(input: {
  pairings: Parameters<typeof roomBoundary>[0]["pairings"];
  runs: Parameters<typeof roomBoundary>[0]["runs"];
  drawn: Parameters<typeof roomBoundary>[0]["drawn"];
  segments: readonly StrokeSegment[];
  doorLeaves: readonly Line[];
  /** The estimator's own lines across a region. Each closes like a wall. */
  splits?: readonly Line[];
  feetPerUnit: number;
  text: readonly PositionedText[];
  widthPt: number;
}): RoomsFromWallsResult {
  const { feetPerUnit, segments } = input;
  const walls = roomBoundary({ pairings: input.pairings, runs: input.runs, drawn: input.drawn });
  const seals = segments.length > 0 ? roomSeals(walls, segments, feetPerUnit) : [];
  const splits = (input.splits ?? []).map((s) => reachingWalls(s, feetPerUnit));
  const lines = [...segments, ...input.doorLeaves];
  const found = (doorSeals: Line[]) => {
    const base = { walls, feetPerUnit, text: input.text, widthPt: input.widthPt, doorSeals };
    return roomsClosedAtDrawnLines(roomsSplitAtDrawnWalls(base, lines), base, lines);
  };
  const whole = found(seals);
  return splits.length === 0 ? whole : splitRooms(whole, splits, feetPerUnit);
}

type Ring = { xs: number[]; ys: number[] };
type Point = { x: number; y: number };

const areaOf = (r: Ring) => Math.abs(r.xs.reduce((sum, x, i) => sum + x * r.ys[(i + 1) % r.xs.length]! - r.xs[(i + 1) % r.xs.length]! * r.ys[i]!, 0)) / 2;
const perimeterOf = (r: Ring) => r.xs.reduce((sum, x, i) => sum + Math.hypot(r.xs[(i + 1) % r.xs.length]! - x, r.ys[(i + 1) % r.ys.length]! - r.ys[i]!), 0);

/**
 * The stretches of `line` that lie inside `ring`, each from boundary to boundary.
 * A concave room can be crossed more than once by one line.
 */
export function chordsOf(ring: Ring, line: Line): [Point, Point][] {
  const n = ring.xs.length;
  const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
  const at: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const ex = ring.xs[j]! - ring.xs[i]!, ey = ring.ys[j]! - ring.ys[i]!;
    const den = dx * ey - dy * ex;
    if (den === 0) continue;
    const t = ((ring.xs[i]! - line.x1) * ey - (ring.ys[i]! - line.y1) * ex) / den;
    const u = ((ring.xs[i]! - line.x1) * dy - (ring.ys[i]! - line.y1) * dx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) at.push(t);
  }
  const ts = [...new Set(at.map((t) => Math.round(t * 1e9) / 1e9))].sort((a, b) => a - b);
  const point = (t: number) => ({ x: line.x1 + t * dx, y: line.y1 + t * dy });
  const out: [Point, Point][] = [];
  for (let k = 0; k + 1 < ts.length; k += 1) {
    const mid = point((ts[k]! + ts[k + 1]!) / 2);
    if (pointInRing(mid.x, mid.y, ring.xs, ring.ys)) out.push([point(ts[k]!), point(ts[k + 1]!)]);
  }
  return out;
}

/** Which edge of `ring` a boundary point lies on, or -1. */
function edgeOf(ring: Ring, p: Point): number {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < ring.xs.length; i += 1) {
    const j = (i + 1) % ring.xs.length;
    const ax = ring.xs[i]!, ay = ring.ys[i]!, bx = ring.xs[j]!, by = ring.ys[j]!;
    const L = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / L));
    const d = Math.hypot(p.x - ax - t * (bx - ax), p.y - ay - t * (by - ay));
    if (d < bestD) { bestD = d; best = i; }
  }
  return bestD < 1e-7 ? best : -1;
}

/** A ring cut along a chord whose ends are on its boundary. */
export function cutAlong(ring: Ring, a: Point, b: Point): [Ring, Ring] | null {
  const ea = edgeOf(ring, a), eb = edgeOf(ring, b);
  if (ea < 0 || eb < 0 || ea === eb) return null;
  const [p, q, ep, eq] = ea < eb ? [a, b, ea, eb] : [b, a, eb, ea];
  const n = ring.xs.length;
  const one: Ring = { xs: [p.x], ys: [p.y] }, two: Ring = { xs: [q.x], ys: [q.y] };
  for (let i = ep + 1; i <= eq; i += 1) one.xs.push(ring.xs[i]!), one.ys.push(ring.ys[i]!);
  one.xs.push(q.x), one.ys.push(q.y);
  for (let k = eq + 1; k <= ep + n; k += 1) two.xs.push(ring.xs[k % n]!), two.ys.push(ring.ys[k % n]!);
  two.xs.push(p.x), two.ys.push(p.y);
  return [one, two];
}

/**
 * ── A SPLIT DIVIDES THE ROOM ITSELF, SO THE PARTS ALWAYS ADD UP ──
 *
 * The grid draws a split as ink, and the strip under it belonged to neither part:
 * Joplin's dining area lost 2.5 sf to a line across it (round 4) and 11 sf to
 * Chrome's along the kitchen's top wall (round 5), where the line crossed the
 * room's outline more than twice and the old one-cut version gave up.
 *
 * So the rooms come from the sheet WITHOUT the splits, and each room a split
 * crosses is cut along every stretch of the line inside it. A stretch that would
 * leave a piece smaller than a room is not cut, so nothing is ever dropped. Each
 * piece takes the tags whose own position is inside it. Rooms a split does not
 * cross are untouched, so the floor total cannot move.
 *
 * A split no longer closes anything. It used to, as a side effect of being ink,
 * and the 1 ft it reaches past each end to meet a wall then poked through that
 * wall and closed a region next door: +33 sf on Joplin from a line drawn wall to
 * wall inside the dining area. The tool's own words are "drag a line across a
 * room from wall to wall"; a room left open is closed with the Line tool.
 */
function splitRooms(whole: RoomsFromWallsResult, splits: readonly Line[], feetPerUnit: number): RoomsFromWallsResult {
  const smallest = SMALLEST_ROOM_SQFT / (feetPerUnit * feetPerUnit);
  const rooms: RoomFromWalls[] = [];
  for (const room of whole.rooms) {
    const pieces: Ring[] = [{ xs: room.xs, ys: room.ys }];
    for (const line of splits) {
      for (const [a, b] of chordsOf({ xs: room.xs, ys: room.ys }, line)) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const k = pieces.findIndex((p) => pointInRing(mid.x, mid.y, p.xs, p.ys));
        if (k < 0) continue;
        const cut = cutAlong(pieces[k]!, a, b);
        if (cut === null || cut.some((c) => areaOf(c) < smallest)) continue;
        pieces.splice(k, 1, ...cut);
      }
    }
    if (pieces.length === 1) {
      rooms.push(room);
      continue;
    }
    const tags = [room.tag, ...(room.sharedTags ?? [])].filter((t): t is RoomTag => t !== null);
    for (const piece of pieces) {
      const inside = tags.filter((t) => { const at = t.numberAt ?? t; return pointInRing(at.x, at.y, piece.xs, piece.ys); });
      rooms.push({
        id: 0,
        squareFeet: areaOf(piece) * feetPerUnit * feetPerUnit,
        perimeterFeet: perimeterOf(piece) * feetPerUnit,
        xs: piece.xs,
        ys: piece.ys,
        tag: inside.length === 1 ? inside[0]! : null,
        ...(inside.length > 1 ? { sharedTags: inside } : {}),
      });
    }
  }
  const numbered = rooms.map((r, id) => ({ ...r, id }));
  return { ...whole, rooms: numbered, mergedTags: numbered.flatMap((r) => r.sharedTags ?? []) };
}
