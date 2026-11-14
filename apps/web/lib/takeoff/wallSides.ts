import { pointInRing } from "./drawTools";

/**
 * ── THE ROOMS EITHER SIDE OF A WALL ──
 *
 * A wall's height comes from the rooms it bounds: their ceilings, and on a set whose walls run to
 * the structure of the roof over them, that roof. Each side is probed just past the middle of the
 * wall's longest segment. One function for the product (`assignWallHeights`) and the height evals,
 * so a measured wall finds the rooms the product finds.
 *
 * ponytail: a fixed offset; a wall drawn thicker than ~1.5 ft at 1/8" scale probes inside itself.
 */
export const SIDE_OFFSET = 0.006;

type Ring = { xs: readonly number[]; ys: readonly number[] };

/** The room on each side of the wall (two entries, null where there is none), probing `offset` page-width units out. */
export function wallSideRooms<R extends Ring>(wall: Ring, rooms: readonly R[], offset = SIDE_OFFSET): (R | null)[] {
  let best = { x1: 0, y1: 0, x2: 0, y2: 0, len: 0 };
  for (let i = 0; i + 1 < wall.xs.length; i += 1) {
    const s = { x1: wall.xs[i]!, y1: wall.ys[i]!, x2: wall.xs[i + 1]!, y2: wall.ys[i + 1]! };
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (len > best.len) best = { ...s, len };
  }
  if (best.len === 0) return [];
  return [1, -1].map((sign) => {
    const px = (best.x1 + best.x2) / 2 + (sign * -(best.y2 - best.y1) / best.len) * offset;
    const py = (best.y1 + best.y2) / 2 + (sign * (best.x2 - best.x1) / best.len) * offset;
    return rooms.find((r) => pointInRing(px, py, r.xs, r.ys)) ?? null;
  });
}
