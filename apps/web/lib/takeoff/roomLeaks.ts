import { roomsFromWalls, type FoundWall } from "./roomsFromWalls";
import type { PositionedText } from "./roomTags";

/**
 * ── WHERE A ROOM LEAKS, AS A HINT THE FINDER CAN USE ──
 *
 * A tag on no closed region, or two tags in one, means a boundary is missing
 * between what was found. This asks the cheapest question that locates it:
 * WHICH SINGLE WALL END, extended straight on by how much, closes the room?
 * Every wall end is tried at each length in `TRY_FEET`, shortest first, and
 * the first extension under which the tag lands in a closed, room-sized
 * region on its own is the hint — a point, a direction and a length, which
 * is exactly the shape of a wall the finder did not propose.
 *
 * It is a probe, not a detector: a room missing a whole wall, or two gaps,
 * gets no single-extension hint and says so (`null`). That is reported
 * rather than guessed at, because a hint in the wrong place sends the
 * finder lane looking at the wrong wall.
 *
 * One flood per (end, length), so each probe runs on a WINDOW: only the walls
 * within `NEAR_FEET` of the tag, on a grid capped at `PROBE_GRID` cells. A
 * boundary set from the finder's raw pairings is a thousand walls on a
 * 3,000-cell grid, and the first version flooded the whole sheet for every
 * end of every one — ten minutes per sheet and still running. Fewer walls
 * can only open regions, never close them, so a room that closes inside the
 * window closes on the sheet.
 */
export const PROBE_GRID = 400;
export const TRY_FEET = [2, 4, 8, 12];
export const NEAR_FEET = 25;
/** Ends of walls shorter than this are not worth extending: a 1 ft stub
 *  pointing the right way is as likely as not a tag box or a door jamb. */
const MIN_WALL_FEET = 2;

export type LeakHint = {
  /** The tag that leaked. */
  tag: { name: string; number: string | null; areaSf: number | null; x: number; y: number };
  /** Null when no single wall extension closes it. */
  hint: {
    /** The wall end, page-width units. */
    x: number;
    y: number;
    /** Unit direction the wall would continue in. */
    dx: number;
    dy: number;
    /** How far it has to go, in feet. */
    lengthFeet: number;
    /** Index into the walls given. */
    wall: number;
    /** The room as it then measures, square feet. */
    squareFeet: number;
  } | null;
};

export function leakHints(input: {
  walls: readonly FoundWall[];
  feetPerUnit: number;
  text: readonly PositionedText[];
  widthPt: number;
  /** Which tags to explain; default = every open or merged tag. */
  only?: (t: { name: string; number: string | null }) => boolean;
  onTag?: (t: { name: string; number: string | null }, ms: number, wallsTried: number) => void;
}): LeakHint[] {
  const base = roomsFromWalls(input);
  const leaking = [...base.unplacedTags, ...base.mergedTags].filter((t) => !input.only || input.only(t));
  const out: LeakHint[] = [];
  const near = NEAR_FEET / input.feetPerUnit;
  for (const tag of leaking) {
    const started = Date.now();
    let found: LeakHint["hint"] = null;
    const window = input.walls
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => Math.hypot(w.x1 - tag.x, w.y1 - tag.y) <= near || Math.hypot(w.x2 - tag.x, w.y2 - tag.y) <= near);
    const windowWalls = window.map((x) => x.w);
    search: for (const feet of TRY_FEET) {
      const ext = feet / input.feetPerUnit;
      for (const { w, i } of window) {
        const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
        if (!(len * input.feetPerUnit >= MIN_WALL_FEET)) continue;
        const ux = (w.x2 - w.x1) / len;
        const uy = (w.y2 - w.y1) / len;
        for (const [ex, ey, dx, dy] of [
          [w.x2, w.y2, ux, uy],
          [w.x1, w.y1, -ux, -uy],
        ] as const) {
          const walls = [...windowWalls, { x1: ex, y1: ey, x2: ex + dx * ext, y2: ey + dy * ext, thicknessFeet: w.thicknessFeet }];
          const r = roomsFromWalls({ ...input, walls, gridCap: PROBE_GRID });
          const room = r.rooms.find((room) => room.tag && room.tag.x === tag.x && room.tag.y === tag.y);
          if (!room) continue;
          found = { x: ex, y: ey, dx, dy, lengthFeet: feet, wall: i, squareFeet: room.squareFeet };
          break search;
        }
      }
    }
    out.push({ tag: { name: tag.name, number: tag.number, areaSf: tag.areaSf, x: tag.x, y: tag.y }, hint: found });
    if (input.onTag) input.onTag(tag, Date.now() - started, window.length);
  }
  return out;
}
