import type { WallCandidate } from "./wallVectors";

/**
 * ── FEWER, TRUER GROUPS: ONE PER LEGEND TYPE WHERE THE THICKNESS SAYS SO ──
 *
 * The finder clusters runs by measured thickness in half-inch steps, and a
 * sheet whose walls are drawn at nine nominal widths comes out as twenty
 * groups: a 7-3/8in cluster beside a 7-5/8in one beside an 8-1/8in one, each
 * a handful of runs, none of them a wall type anybody bids. The legend knows
 * the nominal widths — a stud plus its board layers — and the drawing's
 * noise is about a quarter inch either way.
 *
 * So: runs whose measured thickness is within `noiseIn` of ONE legend type's
 * nominal thickness, and of each other, are one band named for that type.
 * Where two legend types are both within reach of a run (6in stud with one
 * layer against 6in with two is 7.25 against 8.5, fine; 3-5/8 with one layer
 * against 3-5/8 with insulation is the same width and NOT fine) the run is
 * left in its own cluster and the band says why. A run that carries a tag
 * keeps it, and a band whose tagged runs disagree is reported rather than
 * merged.
 *
 * Pure. The finder's own clusters are what go in; what comes out is what a
 * panel could show instead. Nothing here is a price.
 */

/** Drawing noise: a measured thickness this far from a nominal one is that nominal one. */
export const NOISE_IN = 0.375;

export type LegendTypeWidth = {
  code: string;
  /** Nominal wall thickness in inches, or null where the legend did not say. */
  thicknessIn: number | null;
};

export type BandSource =
  | { kind: "LEGEND"; code: string; nominalIn: number }
  | { kind: "AMBIGUOUS"; codes: string[] }
  | { kind: "UNMATCHED" };

export type Band = {
  /** Measured mean thickness of the runs, in inches. */
  inches: number;
  runs: WallCandidate[];
  feet: number;
  source: BandSource;
  /** Tags the runs carried, by code, with feet — more than one is a conflict. */
  tags: { code: string; feet: number }[];
};

/** The nominal thickness of a legend type from its read fields, in inches. */
export function nominalThicknessIn(read: {
  studWidthIn: number | null;
  boardThicknessIn: number | null;
  layersPerSide: number | null;
}): number | null {
  if (read.studWidthIn === null) return null;
  const board = read.boardThicknessIn ?? 0;
  const layers = read.layersPerSide ?? (read.boardThicknessIn === null ? 0 : 1);
  return read.studWidthIn + 2 * layers * board;
}

export function legendBands(input: {
  runs: readonly WallCandidate[];
  types: readonly LegendTypeWidth[];
  /** Run → tag code, for the runs that carry one. */
  tagged?: ReadonlyMap<WallCandidate, string>;
  noiseIn?: number;
}): Band[] {
  const noise = input.noiseIn ?? NOISE_IN;
  const typed = input.types.filter((t): t is { code: string; thicknessIn: number } => t.thicknessIn !== null);
  const buckets = new Map<string, WallCandidate[]>();
  const keyFor = (run: WallCandidate): { key: string; source: BandSource } => {
    const inches = run.thicknessFeet * 12;
    const near = typed.filter((t) => Math.abs(t.thicknessIn - inches) <= noise);
    if (near.length === 1) return { key: `L:${near[0].code}`, source: { kind: "LEGEND", code: near[0].code, nominalIn: near[0].thicknessIn } };
    if (near.length > 1) {
      const codes = near.map((t) => t.code).sort();
      return { key: `A:${codes.join("/")}:${bucketOf(inches, noise)}`, source: { kind: "AMBIGUOUS", codes } };
    }
    return { key: `U:${bucketOf(inches, noise)}`, source: { kind: "UNMATCHED" } };
  };
  const sources = new Map<string, BandSource>();
  for (const run of input.runs) {
    const { key, source } = keyFor(run);
    sources.set(key, source);
    buckets.set(key, [...(buckets.get(key) ?? []), run]);
  }
  const bands: Band[] = [];
  for (const [key, runs] of buckets) {
    const feet = runs.reduce((s, r) => s + r.lengthFeet, 0);
    const inches = runs.reduce((s, r) => s + r.thicknessFeet * 12 * r.lengthFeet, 0) / (feet || 1);
    const tags = new Map<string, number>();
    for (const run of runs) {
      const tag = input.tagged?.get(run);
      if (tag !== undefined) tags.set(tag, (tags.get(tag) ?? 0) + run.lengthFeet);
    }
    bands.push({
      inches,
      runs,
      feet,
      source: sources.get(key)!,
      tags: [...tags].map(([code, ft]) => ({ code, feet: ft })).sort((a, b) => b.feet - a.feet),
    });
  }
  return bands.sort((a, b) => b.feet - a.feet);
}

/** Unmatched runs still cluster among themselves, in steps of twice the noise. */
function bucketOf(inches: number, noise: number): number {
  return Math.round(inches / (2 * noise));
}
