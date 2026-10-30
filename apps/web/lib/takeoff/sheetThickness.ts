import type { WallCandidate } from "./wallVectors";

/**
 * ── A SHEET WHOSE WALLS PILE UP AGAINST THE CAP IS A SHEET THE CAP IS CLIPPING ──
 *
 * The pairer refuses a pair thicker than 13 in (`DEFAULTS.maxThicknessFeet`),
 * and the comment on that number is honest about the price: a courthouse's
 * 16–22 in masonry is a wall and reads as nothing. Raising the cap for every
 * sheet was measured and costs thousands of feet of junk on the sheets that
 * have no such wall — two parallel lines 20 in apart are a corridor, a
 * counter, a dimension string far more often than they are a wall.
 *
 * So the cap is widened per SHEET, from the sheet's own evidence: the walls
 * it paired at the ordinary cap. Where a large share of that footage sits
 * within an inch of the cap, the thickness distribution has been cut off
 * rather than tailed off, and the sheet is paired again to 24 in. Supreme
 * Court A111 has 42% of its accepted footage at 12 in and over; an ordinary
 * stud-wall sheet has a few percent. The share is taken on FEET, not runs,
 * and a sheet with under 100 ft of near-cap wall does not qualify, so one
 * thick pier cannot widen a whole sheet.
 */
export const ORDINARY_CAP_FEET = 13 / 12;
export const WIDE_CAP_FEET = 2;
/** At or above this, a wall counts as "at the cap". */
export const NEAR_CAP_FEET = 1;
export const THICK_SHARE = 0.25;
export const THICK_FLOOR_FEET = 100;

export function thickSheetCap(walls: readonly WallCandidate[]): number | null {
  let all = 0;
  let near = 0;
  for (const w of walls) {
    all += w.lengthFeet;
    if (w.thicknessFeet >= NEAR_CAP_FEET) near += w.lengthFeet;
  }
  if (near < THICK_FLOOR_FEET || all === 0) return null;
  return near / all >= THICK_SHARE ? WIDE_CAP_FEET : null;
}

/**
 * ── THE WIDER PASS MAY ADD WALLS; IT MAY NOT RE-PAIR THE ONES ALREADY FOUND ──
 *
 * Re-running the whole sheet at 24 in was measured (2026-10-30, global sweep):
 * the pairer prefers the WIDEST partner for a face, so every thin wall whose
 * neighbour sits within two feet is re-paired as a fat one — Supreme Court
 * recovered 183 ft and gained 555 ft of extra on the same sheet, and the
 * training set lost recall on ELEVEN03 while gaining 10,906 ft of junk. So the
 * wide pass only ADDS: a thick pair is kept only when no wall the ordinary
 * pass already found lies inside its band. A 16 in masonry wall the first
 * pass could not pair has an empty band; two 6 in walls 20 in apart have each
 * other's centreline in it.
 */
export function bandHoldsAWall(
  thick: WallCandidate,
  found: readonly WallCandidate[],
  feetPerUnit: number,
): boolean {
  const dx = thick.x2 - thick.x1;
  const dy = thick.y2 - thick.y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return false;
  const ux = dx / len;
  const uy = dy / len;
  const half = thick.thicknessFeet / 2 / feetPerUnit;
  const minOverlap = Math.min(len * 0.3, 3 / feetPerUnit);
  for (const w of found) {
    if (w.curved) continue;
    const wx = w.x2 - w.x1;
    const wy = w.y2 - w.y1;
    const wl = Math.hypot(wx, wy);
    if (wl === 0) continue;
    if (Math.abs((wx * ux + wy * uy) / wl) < 0.97) continue;
    const mx = (w.x1 + w.x2) / 2 - thick.x1;
    const my = (w.y1 + w.y2) / 2 - thick.y1;
    const off = Math.abs(mx * uy - my * ux);
    if (off >= half) continue;
    const a1 = (w.x1 - thick.x1) * ux + (w.y1 - thick.y1) * uy;
    const a2 = (w.x2 - thick.x1) * ux + (w.y2 - thick.y1) * uy;
    const overlap = Math.min(len, Math.max(a1, a2)) - Math.max(0, Math.min(a1, a2));
    if (overlap >= minOverlap) return true;
  }
  return false;
}
