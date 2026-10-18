import type { Level, Opening, Pt, TypeCode, Wall } from "./model";

/**
 * THE HOLDOUT SET: seeded random floor plans built from the same partition
 * types, junction types and export quirks as Mesa Ridge.
 *
 * Run once, reported separately. A future fix may be TUNED on the main set and
 * must be VALIDATED here — a threshold moved until Mesa Ridge passes proves
 * only that it passes Mesa Ridge.
 */

export const HOLDOUT_SEEDS = Array.from({ length: 20 }, (_, i) => 1009 + i * 7919);

/** Variants the holdout draws from — every one the main set exercises on a plan. */
export const HOLDOUT_VARIANTS = ["clean", "revit", "autocad", "rotate", "shx", "half-archB", "skia", "plot-black", "clip"];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

export type HoldoutPlan = { seed: number; level: Level; variant: string; dims: [Pt, Pt][] };

export function holdoutPlan(seed: number): HoldoutPlan {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const bays = Array.from({ length: 4 + Math.floor(r() * 4) }, () => pick([24, 26, 27 + 4 / 12, 28, 30, 32]));
  const W = bays.reduce((s, b) => s + b, 0);
  const H = pick([60, 64, 72, 80, 90]);
  const xs = [0, ...bays.map((_, i) => bays.slice(0, i + 1).reduce((s, b) => s + b, 0))];
  const ext: TypeCode = pick(["EXT-1", "EXT-2"]);
  const off = 8 / 12;
  const p = (x: number, y: number): Pt => ({ x, y });
  const deck = pick([13, 14.5]);
  const walls: Wall[] = [
    { id: "X-S", type: ext, a: p(-off, -off), b: p(W + off, -off), heightFt: deck },
    { id: "X-E", type: ext, a: p(W + off, -off), b: p(W + off, H + off), heightFt: deck },
    { id: "X-N", type: ext, a: p(W + off, H + off), b: p(-off, H + off), heightFt: deck },
    { id: "X-W", type: ext, a: p(-off, H + off), b: p(-off, -off), heightFt: deck },
  ];
  // A corridor, double-loaded.
  const cy = Math.round(H * (0.4 + r() * 0.2));
  const cw = pick([5, 6, 8]);
  const x0 = pick([0, 20, 30]) || -off;
  walls.push({ id: "C-S", type: "A1", a: p(x0, cy), b: p(W + off, cy), heightFt: 10.5 });
  walls.push({ id: "C-N", type: "A1", a: p(x0, cy + cw), b: p(W + off, cy + cw), heightFt: 10.5 });
  const partition = (): TypeCode => pick(["A1", "A1", "A1", "A2", "A2", "B1", "C1"]);
  const openings: Opening[] = [];
  let n = 0;
  for (const [y0, y1, side] of [
    [cy + cw, H + off, "N"],
    [-off, cy, "S"],
  ] as [number, number, string][]) {
    let x = Math.max(x0, 0) + pick([8, 10, 12]);
    while (x < W - 6) {
      const t = partition();
      walls.push({ id: `${side}-${n++}`, type: t, a: p(x, y0), b: p(x, y1), heightFt: t === "A2" || t === "B1" || t === "C1" ? deck : 10.5 });
      const roomW = pick([8, 10, 12, 14, 16]);
      const doorX = x + Math.min(roomW - 2, 2 + r() * (roomW - 5));
      if (doorX < W - 3) openings.push({ mark: `${side}${n}`, kind: r() < 0.15 ? "pair" : "door", at: p(doorX + 1.5, side === "N" ? cy + cw : cy), widthFt: 3, heightFt: 7 });
      x += roomW;
    }
  }
  // A back wall on the north side at a random depth, crossing the partitions (X and T).
  const by = cy + cw + pick([12, 14, 16]);
  if (by < H - 8) walls.push({ id: "N-BK", type: "A1", a: p(Math.max(x0, 0) + 4, by), b: p(W - 10, by), heightFt: 10.5 });
  // One angled wall at a random odd angle, and sometimes a curved one.
  const ang = pick([15, 22.5, 30, 37, 45, 60, 72.5]);
  const ax = W * (0.3 + r() * 0.4);
  walls.push({ id: "ANG", type: "A1", a: p(ax, 4), b: p(ax + 14 * Math.cos((ang * Math.PI) / 180), 4 + 14 * Math.sin((ang * Math.PI) / 180)), heightFt: 10.5 });
  if (r() < 0.5) {
    const c = p(W * 0.15, cy * 0.3);
    const rad = pick([12, 18, 22]);
    walls.push({
      id: "ARC",
      type: "A1",
      a: p(c.x + rad * Math.cos(0.3), c.y + rad * Math.sin(0.3)),
      b: p(c.x + rad * Math.cos(1.2), c.y + rad * Math.sin(1.2)),
      arc: { c, r: rad, a0: (0.3 * 180) / Math.PI, a1: (1.2 * 180) / Math.PI },
      heightFt: 10.5,
    });
  }
  // A chase wall and a CMU stair with furring, sometimes.
  if (r() < 0.6) walls.push({ id: "CH", type: "D1", a: p(W - 20, -off), b: p(W - 20, cy), heightFt: deck });
  if (r() < 0.6) {
    walls.push({ id: "CMU-V", type: "CMU", a: p(W - 16, cy + cw), b: p(W - 16, H + off), heightFt: deck });
    walls.push({ id: "FR", type: "F1", a: p(W - 16 - 7.625 / 24 - 1.5 / 24, cy + cw + 0.203), b: p(W - 16 - 7.625 / 24 - 1.5 / 24, H + off), heightFt: deck });
  }
  for (const x of xs.slice(1, -1)) if (r() < 0.5) openings.push({ mark: `W${x.toFixed(0)}`, kind: "window", at: p(x - 6, -off), widthFt: 4, heightFt: 5 });

  const columns: Pt[] = [];
  for (const x of xs) for (const y of [0, Math.round(H / 2), H]) columns.push(p(x, y));
  const dims: [Pt, Pt][] = [];
  for (let i = 0; i < xs.length - 1; i += 1) dims.push([p(xs[i], -off), p(xs[i + 1], -off)]);
  dims.push([p(xs[0], -off), p(xs[xs.length - 1], -off)]);
  dims.push([p(10, cy), p(10, cy + cw)]);
  dims.push([p(10, -off), p(10, cy)]);
  const level: Level = { name: "L1", toDeckFt: deck, walls, openings, columns, rooms: [], soffits: [], dims };
  return { seed, level, variant: HOLDOUT_VARIANTS[Math.floor(r() * HOLDOUT_VARIANTS.length)], dims };
}
