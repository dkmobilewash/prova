import type { PlacedDoor } from "./planTextRead";

/**
 * Which group each placed door sits on, for the panel row that says
 * `door 101A · 3'-0" from the schedule` beside the group's footage.
 *
 * Nearest run across every group, within `withinFeet` of it — a door placed
 * by its mark already sits ON the run the join chose, so the tolerance only
 * matters for a door placed on a detected gap, whose midpoint is the gap's.
 * Pure, so the screen's attribution can be tested without a screen.
 */
export function doorsByGroup(
  groups: readonly { runs: readonly { x1: number; y1: number; x2: number; y2: number }[] }[],
  placed: readonly PlacedDoor[],
  feetPerUnit: number | null,
  withinFeet = 3,
): Map<number, PlacedDoor[]> {
  const out = new Map<number, PlacedDoor[]>();
  // With no calibration the page is the unit: a hundredth of its width.
  const within = feetPerUnit === null || !(feetPerUnit > 0) ? 0.01 : withinFeet / feetPerUnit;
  for (const door of placed) {
    let bestGroup = -1;
    let bestD = Infinity;
    for (let index = 0; index < groups.length; index++) {
      for (const run of groups[index].runs) {
        const d = distance(door, run);
        if (d < bestD) {
          bestD = d;
          bestGroup = index;
        }
      }
    }
    if (bestGroup < 0 || bestD > within) continue;
    out.set(bestGroup, [...(out.get(bestGroup) ?? []), door]);
  }
  return out;
}

function distance(p: { x: number; y: number }, w: { x1: number; y1: number; x2: number; y2: number }): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / len2));
  return Math.hypot(p.x - (w.x1 + t * dx), p.y - (w.y1 + t * dy));
}

/** `3'-0"` from feet, for a door width on screen. */
export function feetInches(feet: number): string {
  const whole = Math.floor(feet);
  const inches = Math.round((feet - whole) * 12);
  return inches === 12 ? `${whole + 1}'-0"` : `${whole}'-${inches}"`;
}

/** `100A · 6'-0" × 7'-0"`, or `100A · 3'-0"` where the schedule printed no height. */
export function doorText(door: Pick<PlacedDoor, "mark" | "widthFt" | "heightFt">): string {
  return door.heightFt === null ? `${door.mark} · ${feetInches(door.widthFt)}` : `${door.mark} · ${feetInches(door.widthFt)} × ${feetInches(door.heightFt)}`;
}

/**
 * ── THE DOORS A GROUP CARRIES, AS THE OPENINGS ITS WALL RUN IS POSTED WITH ──
 *
 * A placed door with a width AND a height from the schedule becomes an
 * opening on the run (`openingWidth` / `openingHeight`, the same fields the
 * by-hand form posts), and `boardedArea` then deducts it or not by the
 * company's own rule — `openingThresholdSqFt`, which NONE / LARGE_ONLY / ALL
 * decide. Nothing is deducted here; this only hands the figures on.
 *
 * A door whose height the schedule did not print cannot be an opening: a
 * width alone is not an area. It is named in `withoutHeight` so the group
 * can say so rather than deducting a guessed 7'-0".
 */
export function openingsFromDoors(doors: readonly Pick<PlacedDoor, "mark" | "widthFt" | "heightFt">[]): {
  openings: { mark: string; widthFt: number; heightFt: number }[];
  withoutHeight: string[];
} {
  const openings: { mark: string; widthFt: number; heightFt: number }[] = [];
  const withoutHeight: string[] = [];
  for (const door of doors) {
    if (door.heightFt !== null && door.heightFt > 0 && door.widthFt > 0) openings.push({ mark: door.mark, widthFt: door.widthFt, heightFt: door.heightFt });
    else withoutHeight.push(door.mark);
  }
  return { openings, withoutHeight };
}
