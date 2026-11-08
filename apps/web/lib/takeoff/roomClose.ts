import { RAW_MIN_FEET } from "./roomBoundary";

type Point = { x: number; y: number };
type Seg = { x1: number; y1: number; x2: number; y2: number };

/**
 * ── "CLOSE ROOM": THE ESTIMATOR'S LINE ACROSS A ROOM'S OPEN SIDE ──
 *
 * A room tag on no closed region is an open room: a wide opening, a missing
 * wall, a cased opening the seals do not bridge. A ceiling contractor needs its
 * area anyway, so the estimator draws the missing side. The line is saved as
 * an ordinary LINEAR measurement with this label and no item — so it is saved
 * with the job, undone like any shape, never posted to a quantity, and read by
 * `roomBoundary` as a wall like every other hand-drawn line.
 */
export const ROOM_BOUNDARY_LABEL = "Room boundary";

/** A drawn row that is a Close-room line rather than a measured run. */
export const isRoomBoundary = (m: { kind: string; label?: string | null }) => m.kind === "LINEAR" && m.label === ROOM_BOUNDARY_LABEL;

/**
 * The ends a Close-room line may snap to: every end of what the room step
 * treats as a wall — the long pairings, the kept runs and the lines drawn by
 * hand — in page-width units.
 */
export function wallEnds(input: {
  pairings: readonly (Seg & { lengthFeet: number })[];
  runs: readonly Seg[];
  drawn: readonly { kind: string; xs: number[]; ys: number[] }[];
}): Point[] {
  const out: Point[] = [];
  const add = (s: Seg) => out.push({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 });
  for (const p of input.pairings) if (p.lengthFeet >= RAW_MIN_FEET) add(p);
  for (const r of input.runs) add(r);
  for (const m of input.drawn) {
    if (m.kind !== "LINEAR") continue;
    for (let i = 0; i < m.xs.length; i += 1) out.push({ x: m.xs[i]!, y: m.ys[i]! });
  }
  return out;
}

/** The nearest wall end within `reach` of `p`, else `p` itself. */
export function snapToWallEnd(p: Point, ends: readonly Point[], reach: number): Point & { snapped: boolean } {
  let best: Point | null = null;
  let bestD = reach;
  for (const e of ends) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d <= bestD) {
      best = e;
      bestD = d;
    }
  }
  return best === null ? { ...p, snapped: false } : { x: best.x, y: best.y, snapped: true };
}
