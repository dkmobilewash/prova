import type { WallCandidate } from "./wallVectors";

/**
 * ── A THIN RUN TWO FEET OFF A WALL IS THE FRONT OF THE CASEWORK ──
 *
 * Base cabinets and counters are drawn as a line 24 in off the wall — the
 * cabinet front — often with a second line an inch or two from it (the
 * counter's nosing, the toe kick), and that pair reads as a thin wall. On the
 * training label files (2026-10-29, `zzJunkKinds` rows) the junk "parallel to
 * a real wall" clustered at a centre offset of 20–28 in, which is casework
 * depth, not a wall's face offered twice.
 *
 * Priced on every offered candidate: a run no thicker than 4 in, lying along
 * a parallel candidate for at least 70% of its own length, with the gap
 * between its near face and that candidate's face at 20–28 in — 442 ft of
 * confirmed junk for 123 ft of real wall, 3.6 to 1 (ELEVEN03 −50, Crosslines
 * −47). The gap is face-to-face so a thick wall and a thin one measure the
 * same thing; the thin run is the one set aside, never the wall it faces.
 */
export const CASEWORK_MAX_THICKNESS_FEET = 4 / 12;
export const CASEWORK_GAP_MIN_FEET = 20 / 12;
export const CASEWORK_GAP_MAX_FEET = 28 / 12;
const ALONG_SHARE = 0.7;

function len(w: WallCandidate): number {
  return Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
}

/** How much of `a` lies alongside `b`, in `a`'s units along its own line. */
function alongside(a: WallCandidate, b: WallCandidate): number {
  const la = len(a);
  if (la === 0) return 0;
  const ux = (a.x2 - a.x1) / la, uy = (a.y2 - a.y1) / la;
  const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
  const b1 = at(b.x1, b.y1), b2 = at(b.x2, b.y2);
  return Math.max(0, Math.min(la, Math.max(b1, b2)) - Math.max(0, Math.min(b1, b2)));
}

function centreOffset(a: WallCandidate, b: WallCandidate): number {
  const la = len(a);
  if (la === 0) return Infinity;
  const mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2;
  return Math.abs((a.x2 - a.x1) * (a.y1 - my) - (a.x1 - mx) * (a.y2 - a.y1)) / la;
}

export function isCaseworkFront(wall: WallCandidate, others: readonly WallCandidate[], feetPerUnit: number): boolean {
  if (wall.thicknessFeet > CASEWORK_MAX_THICKNESS_FEET) return false;
  const lw = len(wall);
  if (lw === 0) return false;
  const ux = (wall.x2 - wall.x1) / lw, uy = (wall.y2 - wall.y1) / lw;
  for (const o of others) {
    if (o === wall) continue;
    const lo = len(o);
    if (lo === 0) continue;
    if (Math.abs(((o.x2 - o.x1) / lo) * ux + ((o.y2 - o.y1) / lo) * uy) < 0.97) continue;
    if (alongside(wall, o) < ALONG_SHARE * lw) continue;
    const gap = centreOffset(wall, o) * feetPerUnit - wall.thicknessFeet / 2 - o.thicknessFeet / 2;
    if (gap >= CASEWORK_GAP_MIN_FEET && gap <= CASEWORK_GAP_MAX_FEET) return true;
  }
  return false;
}
