import type { FoundWall } from "./roomsFromWalls";

/**
 * ── THE BOUNDARY SET THE ROOM STEP IS HANDED ──
 *
 * A room is bounded by every wall there is, not only the ones a drywall sub
 * bids. Measured 2026-10-21 (NOTES-rooms.md §5): the finder's accepted runs
 * alone closed 0 of Bunkie A100's six rooms, because the corridor wall is
 * CMU and the rest of the building is existing; every pairing the finder
 * SAW, long ones only, plus the runs it kept, closed four of them within 5%.
 *
 * So the boundary is three lists, in order of trust:
 *   1. every raw pairing the finder produced on the sheet, at least
 *      `RAW_MIN_FEET` long — 90% of the raw set is 0.67-ft hatch pairs that
 *      fill the existing building with ink and bound nothing;
 *   2. the runs the finder kept (the walls on the panel);
 *   3. the LINEAR measurements already drawn on the sheet by hand — which is
 *      how an estimator closes a room the finder left open: draw the wall,
 *      find the rooms again.
 */
export const RAW_MIN_FEET = 2;

export function roomBoundary(input: {
  pairings: readonly { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet: number }[];
  runs: readonly { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number }[];
  drawn: readonly { kind: string; xs: number[]; ys: number[] }[];
}): FoundWall[] {
  const out: FoundWall[] = [];
  for (const p of input.pairings) {
    if (p.lengthFeet >= RAW_MIN_FEET) out.push({ x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, thicknessFeet: p.thicknessFeet });
  }
  for (const r of input.runs) out.push({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, thicknessFeet: r.thicknessFeet });
  for (const m of input.drawn) {
    if (m.kind !== "LINEAR") continue;
    for (let i = 1; i < m.xs.length; i += 1) out.push({ x1: m.xs[i - 1], y1: m.ys[i - 1], x2: m.xs[i], y2: m.ys[i] });
  }
  return out;
}
