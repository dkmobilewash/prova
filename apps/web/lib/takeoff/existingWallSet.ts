import type { DemoRun } from "./demoWalls";
import { alignViews, type Line } from "./viewAlign";

export type ExistingWallRun = Line & { lengthFeet: number; fate: "remove" | "remain" };

export type ExistingWallSet = {
  level: string | null;
  /** How far the demolition plan was moved to sit on the new plan, page-width units. Null when no alignment was found. */
  shift: { dx: number; dy: number; votes: number } | null;
  /** In the NEW plan's coordinates when `shift` is set, otherwise the demolition plan's own. */
  walls: ExistingWallRun[];
};

/**
 * The walls standing on a level before the job starts, for comparing with the
 * new plan on that level: the demolition plan's runs to remove, plus its solid
 * walls to remain, moved onto the new plan by `alignViews`. The two sheets must
 * be at one scale; an unaligned set is returned as it is, with `shift` null, so
 * a caller cannot mistake it for aligned.
 */
export function existingWallSet(input: {
  level: string | null;
  remove: readonly DemoRun[];
  remain: readonly (Line & { lengthFeet: number })[];
  newPlan: readonly Line[];
  feetPerUnit: number;
}): ExistingWallSet {
  const own: ExistingWallRun[] = [
    ...input.remove.map((r) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFeet: r.lengthFeet, fate: "remove" as const })),
    ...input.remain.map((r) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFeet: r.lengthFeet, fate: "remain" as const })),
  ];
  const shift = alignViews(input.newPlan, own, input.feetPerUnit);
  if (shift === null) return { level: input.level, shift: null, walls: own };
  return {
    level: input.level,
    shift,
    walls: own.map((w) => ({ ...w, x1: w.x1 + shift.dx, y1: w.y1 + shift.dy, x2: w.x2 + shift.dx, y2: w.y2 + shift.dy })),
  };
}
