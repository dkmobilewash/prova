import type { StrokeSegment } from "./wallVectors";

/**
 * ── A HATCH CONFINED TO A BAND BETWEEN TWO FACES IS A WALL, NOT A FIELD ──
 *
 * The in-a-hatch class withholds a single line with three or more parallel
 * neighbours within 3 ft. Measured on the held-out buildings as a total, it is
 * the one stage that hides real wall there — 942 of 2,109 missed feet — and
 * seven times more per foot of key than on training, which draws few walls
 * filled. A rated or masonry wall is drawn as two faces with hatch between
 * them; at 14 in the faces sit above the pairer's 13 in cap, so both arrive
 * here single, each counting the other and the fill as its "hatch", and the
 * wall is withheld BECAUSE it was drawn solid (ELEVEN03 A4.B.1's 2-hour
 * walls, 14 in, diagonal hatch, no label ever offered them).
 *
 * What separates that from a floor pattern is confinement: the hatch stops at
 * the far face and does not continue beyond it or across the near one. And
 * what separates it from a notes panel — Camp Bow Wow's "FENCE TYPES" box
 * met every geometric test, its "fill" being lettering between rules — is
 * that no word sits inside the band.
 *
 * Thresholds are the probe's (`realplan/zzBandedHatch.eval.ts`): a long
 * parallel partner 3–16 in away overlapping half the line, at least three
 * non-parallel strokes inside the band, no more than a quarter as many just
 * beyond it or across the line, and no text inside. On training that shape is
 * 23 lines on three buildings, which is too few to tune on, and the numbers
 * are deliberately coarse for that reason.
 */
export const BAND_MIN_FEET = 3 / 12;
export const BAND_MAX_FEET = 16 / 12;
export const FILL_MIN_STROKES = 3;
export const SPILL_SHARE = 0.25;

type G = { x1: number; y1: number; x2: number; y2: number };
const len = (g: G) => Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
const parallel = (a: G, b: G) => {
  const p = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const q = Math.atan2(b.y2 - b.y1, b.x2 - b.x1);
  return Math.abs(Math.cos(p - q)) >= 0.97;
};
function overlapAlong(a: G, b: G): number {
  const la = len(a);
  if (la === 0) return 0;
  const ux = (a.x2 - a.x1) / la;
  const uy = (a.y2 - a.y1) / la;
  const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
  const b1 = at(b.x1, b.y1);
  const b2 = at(b.x2, b.y2);
  return Math.max(0, Math.min(la, Math.max(b1, b2)) - Math.max(0, Math.min(b1, b2)));
}

export type BandedWall = { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet: number };

/**
 * The wall a withheld line bounds, when its hatch is a confined band with no
 * text in it; null otherwise. Everything in page-width units except the feet.
 */
export function bandedFillWall(
  line: G,
  strokes: readonly StrokeSegment[],
  words: readonly { x: number; y: number }[],
  feetPerUnit: number,
): BandedWall | null {
  const L = len(line);
  if (L === 0) return null;
  const ux = (line.x2 - line.x1) / L;
  const uy = (line.y2 - line.y1) / L;
  const signedOff = (x: number, y: number) => ((x - line.x1) * -uy + (y - line.y1) * ux) * feetPerUnit;
  const along = (x: number, y: number) => ((x - line.x1) * ux + (y - line.y1) * uy) / L;
  const inSpan = (x: number, y: number) => { const a = along(x, y); return a >= -0.02 && a <= 1.02; };
  let best: { side: 1 | -1; partner: number; inside: number } | null = null;
  for (const side of [1, -1] as const) {
    let partner = 0;
    for (const s of strokes) {
      if (!parallel(line, s) || overlapAlong(line, s) < 0.5 * L) continue;
      const d = side * signedOff((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
      if (d >= BAND_MIN_FEET && d <= BAND_MAX_FEET && d > partner) partner = d;
    }
    if (partner === 0) continue;
    let inside = 0;
    let beyond = 0;
    let across = 0;
    for (const s of strokes) {
      const mx = (s.x1 + s.x2) / 2;
      const my = (s.y1 + s.y2) / 2;
      if (!inSpan(mx, my) || parallel(line, s)) continue;
      const d = side * signedOff(mx, my);
      if (d > 0.04 && d < partner - 0.04) inside += 1;
      else if (d > partner + 0.04 && d <= partner + Math.max(partner, 0.5)) beyond += 1;
      else if (d < -0.04 && d >= -Math.max(partner, 0.5)) across += 1;
    }
    if (inside < FILL_MIN_STROKES) continue;
    if (beyond > inside * SPILL_SHARE || across > inside * SPILL_SHARE) continue;
    if (words.some((w) => { const d = side * signedOff(w.x, w.y); return d > 0 && d < partner && inSpan(w.x, w.y); })) continue;
    if (best === null || inside > best.inside) best = { side, partner, inside };
  }
  if (best === null) return null;
  // The centreline sits half a thickness toward the partner.
  const shift = (best.side * best.partner) / 2 / feetPerUnit;
  const nx = -uy * shift;
  const ny = ux * shift;
  return {
    x1: line.x1 + nx,
    y1: line.y1 + ny,
    x2: line.x2 + nx,
    y2: line.y2 + ny,
    lengthFeet: L * feetPerUnit,
    thicknessFeet: best.partner,
  };
}
