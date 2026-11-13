/**
 * ── A SHEET'S FOUND DOORS WITH NO PRINTED MARK, TO CONFIRM ──
 *
 * A marked door posts itself (`autoDoors.ts`: 98.1% training / 100% held-out). A door the finder
 * draws with no mark beside it is right ≈93.5% of the time on training (143 found, 10 false;
 * ROUND 17+17b, 2026-11-12), under the 97% bar, so it never posts itself. It was not asked either:
 * 143 doors on the training sheets were found and then dropped. Like windows, they are now one
 * queue item per sheet: each lit on its leaf, D drops a false one, Enter keeps the rest, and the
 * kept ones join the job's "Doors" count.
 */
export const DOORS_SUGGESTED = "DOORS_SUGGESTED";
/** One found door, on its leaf line (hinge to strike), page-width units. */
export type StoredDoor = { x1: number; y1: number; x2: number; y2: number };
export type StoredDoors = { doors: StoredDoor[]; decided?: boolean };

/** The label a confirmed unmarked door's count carries on the "Doors" item. */
export const CONFIRMED_DOORS_LABEL = "Doors (confirmed, no printed mark)";

/** The sheet's found doors with no mark, to store; null when there are none. */
export function doorsToStore(doors: readonly { hinge: { x: number; y: number }; strike: { x: number; y: number } }[], marks: readonly (string | null)[]): StoredDoors | null {
  const out = doors.flatMap((d, i) => (marks[i] ? [] : [{ x1: d.hinge.x, y1: d.hinge.y, x2: d.strike.x, y2: d.strike.y }]));
  return out.length === 0 ? null : { doors: out };
}

/** A stored read, or null when it is not one. */
export function storedDoorsOf(value: unknown): StoredDoors | null {
  const v = value as Partial<StoredDoors> | null;
  if (v === null || typeof v !== "object" || !Array.isArray(v.doors)) return null;
  const doors = v.doors.filter((d): d is StoredDoor => d !== null && typeof d === "object" && [d.x1, d.y1, d.x2, d.y2].every((n) => Number.isFinite(n)));
  return { doors, decided: v.decided === true };
}
