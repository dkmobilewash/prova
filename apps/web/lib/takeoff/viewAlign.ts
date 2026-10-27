/**
 * ── WHERE THE SAME PLAN SITS IN TWO VIEWS OF ONE SHEET ──
 *
 * An RCP drawn beside its floor plan (Albany A-100, Murray A101) is the same
 * walls shifted across the page. The shift is found by VOTE: every long
 * wall in one view against every wall of the same orientation and length in
 * the other proposes a translation, and the translation most of them agree
 * on is the answer. A min-corner alignment was tried first and was 98 ft
 * off on Murray, because the RCP's region also holds the legend column and
 * its ruled lines set the corner.
 */
export type Line = { x1: number; y1: number; x2: number; y2: number };

export function alignViews(
  target: readonly Line[],
  source: readonly Line[],
  feetPerUnit: number,
  minFeet = 8,
): { dx: number; dy: number; votes: number } | null {
  const long = (ls: readonly Line[]) =>
    ls
      .map((l) => {
        const dx = l.x2 - l.x1;
        const dy = l.y2 - l.y1;
        const len = Math.hypot(dx, dy) * feetPerUnit;
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        return { mx: (l.x1 + l.x2) / 2, my: (l.y1 + l.y2) / 2, len, horizontal };
      })
      .filter((l) => l.len >= minFeet);
  const a = long(target);
  const b = long(source);
  if (a.length === 0 || b.length === 0) return null;
  const bin = 1 / feetPerUnit; // one foot
  const votes = new Map<string, { dx: number; dy: number; n: number }>();
  for (const x of a)
    for (const y of b) {
      if (x.horizontal !== y.horizontal || Math.abs(x.len - y.len) > Math.max(0.5, 0.05 * x.len)) continue;
      const dx = x.mx - y.mx;
      const dy = x.my - y.my;
      const key = `${Math.round(dx / bin)},${Math.round(dy / bin)}`;
      const v = votes.get(key) ?? { dx: 0, dy: 0, n: 0 };
      v.dx += dx;
      v.dy += dy;
      v.n += 1;
      votes.set(key, v);
    }
  const best = [...votes.values()].sort((p, q) => q.n - p.n)[0];
  if (best === undefined || best.n < 3) return null;
  return { dx: best.dx / best.n, dy: best.dy / best.n, votes: best.n };
}
