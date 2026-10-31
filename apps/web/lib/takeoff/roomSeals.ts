import { doorSymbols } from "./doorWindowSymbols";
import { cornerSeals, type FoundWall } from "./roomsFromWalls";
import type { StrokeSegment } from "./wallVectors";

type Line = { x1: number; y1: number; x2: number; y2: number };

/** A corner gap counts as a doorway if a swing's middle is this close to the gap's middle, feet. */
export const CORNER_DOOR_REACH_FEET = 2;

/**
 * ── WHAT CLOSES A DOORWAY, READ OFF THE DOORS THEMSELVES ──
 *
 * A room stays open at a door the wall finder cannot bridge, and an open room
 * has no floor. Every door swing on the sheet is drawn as a seal, hinge to
 * strike. So is a corner gap, but only with a swing drawn at it: sealing every
 * corner gap measured 49 BIM rooms out of 5%, because most are not doors.
 *
 * Page-width units, like the walls.
 */
export function roomSeals(walls: readonly FoundWall[], segments: readonly StrokeSegment[], feetPerUnit: number): Line[] {
  const doors = doorSymbols(segments, [], feetPerUnit).map((d) => ({ x1: d.hinge.x, y1: d.hinge.y, x2: d.strike.x, y2: d.strike.y }));
  const reach = CORNER_DOOR_REACH_FEET / feetPerUnit;
  const mid = (l: Line) => ({ x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 });
  const corners = cornerSeals(walls, feetPerUnit).filter((seal) => {
    const m = mid(seal);
    return doors.some((d) => Math.hypot(mid(d).x - m.x, mid(d).y - m.y) <= reach);
  });
  return [...doors, ...corners];
}
