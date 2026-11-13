import type { ScoredPairing } from "./demotedRuns";
import { greyShare } from "./greyExisting";
import { flaggedRuns } from "./newWorkFlags";
import { FEATURE_NAMES } from "./wallFeatures";
import { scoreCandidate, type WallModel } from "./wallClassifier";
import { tagByRun, wallTypeTags, type PageTextItem } from "./wallTags";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── ONE ROW OF SIGNALS PER RUN ON OFFER: WHAT THE LEARNED SCORERS READ ──
 *
 * METHOD v2 (AUTOMATION-PLAN.md, 2026-11-13): a hand rule fits the plans it
 * was written on (grey-minority 13.7:1 on training, 3.3:1 held-out), so each
 * signal the finder computes becomes a column here and a small model decides.
 * The same function feeds the eval's feature table and the product, so the
 * model is scored on exactly what the app will hand it.
 *
 * No sheet or set identity is a column: only what the drawing says.
 */

type Line = { x1: number; y1: number; x2: number; y2: number };

/** Columns, in order. Bump `RUN_FEATURES_VERSION` when this list changes. */
export const RUN_FEATURE_NAMES = [
  "lengthFeet", "thicknessIn", "curved", "balancedFaces", "endsMeet", "pairings", "modelScore",
  ...FEATURE_NAMES.map((n) => `pair_${n}`),
  "typeTag", "newWorkFlag", "greyShare", "sheetGreyShare", "greyMinority", "existWords5", "existWords15",
  "renovation", "paired", "demoAt05", "demoAt15", "demoFacesBoth", "demoFacesOne", "keptByCompare", "heldOffEstimate",
] as const;
/** v2: the sheet-size columns (feet per point, runs, feet on the sheet) are gone — LOSO showed them acting as a set fingerprint. */
export const RUN_FEATURES_VERSION = 2;

/** Existing / not-in-contract words, as the renovation sheets print them. */
const EXIST_WORDS = /\bN\.?\s?I\.?\s?C\b|NOT IN CONTRACT|\bEXIST|\(E\)|TO REMAIN|\bE\.?T\.?R\b/i;
/** One run's end this close to another run meets it, in feet. */
const MEET_FEET = 1.5;

const len = (l: Line) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1);

function toSegment(px: number, py: number, s: Line): number {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l = dx * dx + dy * dy;
  const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / l));
  return Math.hypot(px - s.x1 - t * dx, py - s.y1 - t * dy);
}

/** Share of `base`'s length that parallel lines in `lines` cover within `reach` (units). */
export function coverShare(base: Line, lines: readonly Line[], reach: number): number {
  const l = len(base);
  if (l === 0) return 0;
  const ux = (base.x2 - base.x1) / l, uy = (base.y2 - base.y1) / l, spans: [number, number][] = [];
  for (const p of lines) {
    const pl = len(p);
    if (pl === 0 || Math.abs(((p.x2 - p.x1) * ux + (p.y2 - p.y1) * uy) / pl) < 0.97) continue;
    const off = (x: number, y: number) => Math.abs((x - base.x1) * uy - (y - base.y1) * ux);
    if (Math.max(off(p.x1, p.y1), off(p.x2, p.y2)) > reach) continue;
    const a = (p.x1 - base.x1) * ux + (p.y1 - base.y1) * uy, b = (p.x2 - base.x1) * ux + (p.y2 - base.y1) * uy;
    const lo = Math.max(0, Math.min(a, b)), hi = Math.min(l, Math.max(a, b));
    if (hi > lo) spans.push([lo, hi]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  let c = 0, e = 0;
  for (const [lo, hi] of spans) if (hi > e) { c += hi - Math.max(lo, e); e = hi; }
  return c / l;
}

/** True when pairing `p` lies along `run` (parallel, inside its band, half its length on it). */
function along(run: Line & { thicknessFeet: number }, p: ScoredPairing, fpu: number): boolean {
  const rl = len(run), pl = len(p);
  if (rl === 0 || pl === 0) return false;
  const ux = (run.x2 - run.x1) / rl, uy = (run.y2 - run.y1) / rl;
  if (Math.abs(((p.x2 - p.x1) * ux + (p.y2 - p.y1) * uy) / pl) < 0.98) return false;
  const mx = (p.x1 + p.x2) / 2 - run.x1, my = (p.y1 + p.y2) / 2 - run.y1, band = Math.max(run.thicknessFeet, p.thicknessFeet, 0.1) / fpu;
  if (Math.abs(mx * uy - my * ux) > band) return false;
  const a = (p.x1 - run.x1) * ux + (p.y1 - run.y1) * uy, b = (p.x2 - run.x1) * ux + (p.y2 - run.y1) * uy;
  return Math.min(Math.max(a, b), rl) - Math.max(Math.min(a, b), 0) >= 0.5 * pl;
}

export type RunFeatureInput = {
  /** Every run on offer before the demolition-plan compare, page-width units. */
  runs: readonly WallCandidate[];
  /** The runs the compare left on offer (all of `runs` when the sheet has no aligned prior plan). */
  kept: ReadonlySet<WallCandidate>;
  /** The runs the shipped estimate hold keeps off the estimate. */
  heldOff: ReadonlySet<WallCandidate>;
  pairings: readonly ScoredPairing[];
  model: WallModel;
  /** The sheet's strokes and words, in page points. */
  segments: readonly StrokeSegment[];
  textItems: readonly PageTextItem[];
  widthPt: number;
  feetPerUnit: number;
  renovation: boolean;
  /** The aligned prior (demolition) plan: its walls and long faces, already shifted onto this sheet. */
  prior?: { lines: readonly Line[]; faces: readonly Line[] };
};

/** One row per run, columns as `RUN_FEATURE_NAMES`. */
export function runFeatureRows(input: RunFeatureInput): number[][] {
  const { runs, segments, textItems, widthPt: W, feetPerUnit: fpu, prior } = input;
  const tags = tagByRun([...runs], wallTypeTags(textItems, W), fpu);
  const flagged = flaggedRuns(runs, segments, textItems, W, fpu);
  const grey = runs.map((r) => greyShare(r, segments, W, fpu));
  const sheetFeet = runs.reduce((n, r) => n + r.lengthFeet, 0);
  const sheetGrey = sheetFeet === 0 ? 0 : runs.reduce((n, r, i) => n + (grey[i]! >= 0.8 ? r.lengthFeet : 0), 0) / sheetFeet;
  const exist = textItems.filter((t) => EXIST_WORDS.test(t.str)).map((t) => ({ x: t.x / W, y: t.y / W }));
  const reach = MEET_FEET / fpu;
  return runs.map((r, i) => {
    let best = -1, feat: number[] | null = null, n = 0;
    for (const p of input.pairings) {
      if (!along(r, p, fpu)) continue;
      n += 1;
      const s = scoreCandidate(input.model, p.features);
      if (s > best) { best = s; feat = p.features; }
    }
    const ends = [[r.x1, r.y1], [r.x2, r.y2]].filter(([x, y]) => runs.some((o) => o !== r && toSegment(x!, y!, o) <= reach)).length;
    const mx = (r.x1 + r.x2) / 2, my = (r.y1 + r.y2) / 2;
    const wordAt = (feet: number) => (exist.some((e) => Math.hypot(e.x - mx, e.y - my) * fpu <= feet) ? 1 : 0);
    let demo = [-1, -1, -1, -1];
    if (prior !== undefined) {
      const L = len(r), nx = L === 0 ? 0 : -(r.y2 - r.y1) / L, ny = L === 0 ? 0 : (r.x2 - r.x1) / L;
      const face = (sg: number) => { const o = (sg * r.thicknessFeet) / 2 / fpu; return { x1: r.x1 + nx * o, y1: r.y1 + ny * o, x2: r.x2 + nx * o, y2: r.y2 + ny * o }; };
      const f1 = coverShare(face(1), prior.faces, 0.5 / fpu), f2 = coverShare(face(-1), prior.faces, 0.5 / fpu);
      demo = [coverShare(r, prior.lines, 0.5 / fpu), coverShare(r, prior.lines, 1.5 / fpu), Math.min(f1, f2), Math.max(f1, f2, coverShare(r, prior.faces, 0.5 / fpu))];
    }
    const g = grey[i]!;
    return [
      r.lengthFeet, r.thicknessFeet * 12, r.curved === true ? 1 : 0, (r as { fromBalancedFaces?: boolean }).fromBalancedFaces === true ? 1 : 0, ends, n, best,
      ...(feat ?? FEATURE_NAMES.map(() => -1)),
      tags.has(r) ? 1 : 0, flagged.has(r) ? 1 : 0, g, sheetGrey, g >= 0.8 && sheetGrey < 0.4 ? 1 : 0, wordAt(5), wordAt(15),
      input.renovation ? 1 : 0, prior === undefined ? 0 : 1, ...demo, input.kept.has(r) ? 1 : 0, input.heldOff.has(r) ? 1 : 0,
    ];
  });
}
