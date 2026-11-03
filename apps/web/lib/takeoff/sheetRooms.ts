import { roomBoundary } from "./roomBoundary";
import { roomSeals } from "./roomSeals";
import { roomsClosedAtDrawnLines, roomsSplitAtDrawnWalls, type RoomsFromWallsResult } from "./roomsFromWalls";
import type { PositionedText } from "./roomTags";
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
  const parts = found([...seals, ...splits]);
  return splits.length === 0 ? parts : exactParts(parts, found(seals), splits, feetPerUnit);
}

type Ring = { xs: number[]; ys: number[] };

/** A ring cut in two by a line crossing it exactly twice, or null. */
export function cutRing(ring: Ring, line: Line): [Ring, Ring] | null {
  const n = ring.xs.length;
  const hits: { at: number; edge: number; x: number; y: number }[] = [];
  const dx = line.x2 - line.x1, dy = line.y2 - line.y1;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const ex = ring.xs[j]! - ring.xs[i]!, ey = ring.ys[j]! - ring.ys[i]!;
    const den = dx * ey - dy * ex;
    if (den === 0) continue;
    const t = ((ring.xs[i]! - line.x1) * ey - (ring.ys[i]! - line.y1) * ex) / den;
    const u = ((ring.xs[i]! - line.x1) * dy - (ring.ys[i]! - line.y1) * dx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u < 1) hits.push({ at: t, edge: i, x: line.x1 + t * dx, y: line.y1 + t * dy });
  }
  if (hits.length !== 2) return null;
  const [a, b] = hits[0]!.edge <= hits[1]!.edge ? [hits[0]!, hits[1]!] : [hits[1]!, hits[0]!];
  const one: Ring = { xs: [a.x], ys: [a.y] }, two: Ring = { xs: [b.x], ys: [b.y] };
  for (let i = a.edge + 1; i <= b.edge; i += 1) one.xs.push(ring.xs[i]!), one.ys.push(ring.ys[i]!);
  one.xs.push(b.x), one.ys.push(b.y);
  for (let k = b.edge + 1; k <= a.edge + n; k += 1) two.xs.push(ring.xs[k % n]!), two.ys.push(ring.ys[k % n]!);
  two.xs.push(a.x), two.ys.push(a.y);
  return [one, two];
}

const areaOf = (r: Ring) => Math.abs(r.xs.reduce((sum, x, i) => sum + x * r.ys[(i + 1) % r.xs.length]! - r.xs[(i + 1) % r.xs.length]! * r.ys[i]!, 0)) / 2;
const perimeterOf = (r: Ring) => r.xs.reduce((sum, x, i) => sum + Math.hypot(r.xs[(i + 1) % r.xs.length]! - x, r.ys[(i + 1) % r.ys.length]! - r.ys[i]!), 0);
const centroidOf = (r: Ring) => ({ x: r.xs.reduce((a, b) => a + b, 0) / r.xs.length, y: r.ys.reduce((a, b) => a + b, 0) / r.ys.length });

/**
 * A split draws its line as ink, so the grid's parts lose the strip under it and
 * no longer add up to the room (Joplin's dining: 1,646 sf became 1,157 + 478).
 * So each split room takes its shape from the unsplit room cut along the lines,
 * and keeps the tags the grid gave it. Where a cut or a match is not one to one,
 * the grid's parts stand.
 * ponytail: matches a piece to a part by the part's vertex mean, which an L-shaped part can sit outside; it then falls back.
 */
function exactParts(parts: RoomsFromWallsResult, whole: RoomsFromWallsResult, splits: readonly Line[], feetPerUnit: number): RoomsFromWallsResult {
  const rooms = [...parts.rooms];
  for (const room of whole.rooms) {
    let pieces: Ring[] = [{ xs: room.xs, ys: room.ys }];
    for (const line of splits) pieces = pieces.flatMap((p) => cutRing(p, line) ?? [p]);
    if (pieces.length < 2) continue;
    const owner = pieces.map((piece) => rooms.filter((r) => { const c = centroidOf(r); return pointInRing(c.x, c.y, piece.xs, piece.ys); }));
    if (owner.some((o) => o.length !== 1) || new Set(owner.map((o) => o[0])).size !== pieces.length) continue;
    pieces.forEach((piece, i) => {
      const part = owner[i]![0]!;
      rooms[rooms.indexOf(part)] = { ...part, xs: piece.xs, ys: piece.ys, squareFeet: areaOf(piece) * feetPerUnit * feetPerUnit, perimeterFeet: perimeterOf(piece) * feetPerUnit };
    });
  }
  return { ...parts, rooms };
}
