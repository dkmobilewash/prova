import { FEATURE_NAMES } from "./wallFeatures";

/**
 * ── TURNING A REVIEWED SHEET INTO TRAINING ROWS ──
 *
 * A reviewer judges the RUNS the finder shows them. The model decides
 * PAIRINGS, before those runs are merged and filtered. The two are not the
 * same list and never will be: one run can be several pairings joined across
 * openings, and most pairings never become a run at all.
 *
 * So the verdict has to be carried from the run back to the pairings it was
 * made of. That is this file, and it is kept out of the component because it
 * is the part that can be wrong in a way nobody would see — a label silently
 * attached to the wrong candidate trains the model to do the opposite of what
 * the reviewer said.
 *
 * ── WHAT EACH LABEL MEANS ──
 *
 *   1  the reviewer accepted a run that this pairing lies along
 *   0  the reviewer rejected the run it lies along, or no run covers it on a
 *      sheet the reviewer finished
 *   —  unreviewed: left out of the file entirely rather than guessed at
 *
 * The third case is why `reviewComplete` is a parameter. On a half-reviewed
 * sheet, "no run covers this" means nothing; on a finished one it means the
 * reviewer saw the sheet and did not call it a wall, which is a real negative
 * and the most common one.
 */

export type LabelCandidate = {
  /** Page-width units, as the finder works in. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthFeet: number;
  thicknessFeet: number;
  features: number[];
};

export type LabelVerdict = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthFeet: number;
  thicknessFeet: number;
  /** What the reviewer said about this run. */
  verdict: "wall" | "not-wall" | "traced";
};

export type LabelRow = {
  features: number[];
  label: 0 | 1;
  lengthFt: number;
  /** How the label was arrived at, so a strange training set can be read. */
  from: "accepted-run" | "rejected-run" | "no-run";
};

export type LabelFile = {
  format: "takeoff-labels-v1";
  set: string;
  sheet: string;
  page: number;
  reviewedBy: string;
  reviewedAt: string;
  /** Seconds of wall-clock the reviewer spent with this sheet open. */
  secondsSpent: number;
  feetPerUnit: number;
  featureNames: string[];
  reviewComplete: boolean;
  counts: { accepted: number; rejected: number; traced: number; unreviewed: number };
  rows: LabelRow[];
  /** Walls the reviewer drew because nothing was offered. No feature vector
   *  exists for these — nothing proposed them — so they are kept apart rather
   *  than invented into rows. */
  traced: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number }[];
};

const lengthOf = (l: { x1: number; y1: number; x2: number; y2: number }) =>
  Math.hypot(l.x2 - l.x1, l.y2 - l.y1);

/** How far the two run in the same direction: 1 is parallel, 0 perpendicular. */
function parallelism(a: LabelCandidate | LabelVerdict, b: LabelCandidate | LabelVerdict): number {
  const la = lengthOf(a) || 1;
  const lb = lengthOf(b) || 1;
  return Math.abs(
    ((a.x2 - a.x1) / la) * ((b.x2 - b.x1) / lb) + ((a.y2 - a.y1) / la) * ((b.y2 - b.y1) / lb),
  );
}

/** Perpendicular distance from b's midpoint to a's line. */
function offset(a: LabelVerdict, b: LabelCandidate): number {
  const len = lengthOf(a) || 1;
  const ux = (a.x2 - a.x1) / len;
  const uy = (a.y2 - a.y1) / len;
  const mx = (b.x1 + b.x2) / 2;
  const my = (b.y1 + b.y2) / 2;
  return Math.abs(-(mx - a.x1) * uy + (my - a.y1) * ux);
}

/** How much of b lies alongside a, along a's direction. */
function overlap(a: LabelVerdict, b: LabelCandidate): number {
  const len = lengthOf(a);
  if (!(len > 0)) return 0;
  const ux = (a.x2 - a.x1) / len;
  const uy = (a.y2 - a.y1) / len;
  const at = (x: number, y: number) => (x - a.x1) * ux + (y - a.y1) * uy;
  const lo = Math.max(0, Math.min(at(b.x1, b.y1), at(b.x2, b.y2)));
  const hi = Math.min(len, Math.max(at(b.x1, b.y1), at(b.x2, b.y2)));
  return Math.max(0, hi - lo);
}

/**
 * Whether this pairing is part of that run.
 *
 * Generous on length — a run is often several pairings — and strict on
 * position and direction, because the cost of being wrong is a label on the
 * wrong candidate.
 */
function belongsTo(run: LabelVerdict, candidate: LabelCandidate, feetPerUnit: number): boolean {
  if (parallelism(run, candidate) < 0.98) return false;
  // Within about a wall's thickness of the run's own line.
  const band = Math.max(run.thicknessFeet, candidate.thicknessFeet, 0.1) / feetPerUnit;
  if (offset(run, candidate) > band) return false;
  // And actually alongside it, not merely on the same infinite line.
  return overlap(run, candidate) >= 0.5 * lengthOf(candidate);
}

/**
 * The rows for one reviewed sheet.
 *
 * `feetPerUnit` converts the geometry's units to feet; everything else is in
 * the units the finder produced.
 */
export function labelRows(
  candidates: readonly LabelCandidate[],
  verdicts: readonly LabelVerdict[],
  feetPerUnit: number,
  reviewComplete: boolean,
): LabelRow[] {
  const judged = verdicts.filter((v) => v.verdict !== "traced");
  const rows: LabelRow[] = [];
  for (const candidate of candidates) {
    // A candidate can lie under more than one run; an ACCEPTED one wins,
    // because the reviewer said that wall is real and this pairing is part of
    // how it was found.
    let best: LabelVerdict | null = null;
    for (const run of judged) {
      if (!belongsTo(run, candidate, feetPerUnit)) continue;
      if (best === null || (run.verdict === "wall" && best.verdict !== "wall")) best = run;
    }
    if (best === null) {
      if (!reviewComplete) continue;
      rows.push({
        features: candidate.features,
        label: 0,
        lengthFt: candidate.lengthFeet,
        from: "no-run",
      });
      continue;
    }
    rows.push({
      features: candidate.features,
      label: best.verdict === "wall" ? 1 : 0,
      lengthFt: candidate.lengthFeet,
      from: best.verdict === "wall" ? "accepted-run" : "rejected-run",
    });
  }
  return rows;
}

/** The file as it is written, with the counts a reader needs to judge it. */
export function labelFile(input: {
  set: string;
  sheet: string;
  page: number;
  reviewedBy: string;
  secondsSpent: number;
  feetPerUnit: number;
  reviewComplete: boolean;
  candidates: readonly LabelCandidate[];
  verdicts: readonly LabelVerdict[];
  unreviewed: number;
}): LabelFile {
  const rows = labelRows(input.candidates, input.verdicts, input.feetPerUnit, input.reviewComplete);
  const traced = input.verdicts.filter((v) => v.verdict === "traced");
  return {
    format: "takeoff-labels-v1",
    set: input.set,
    sheet: input.sheet,
    page: input.page,
    reviewedBy: input.reviewedBy,
    reviewedAt: new Date().toISOString(),
    secondsSpent: Math.round(input.secondsSpent),
    feetPerUnit: input.feetPerUnit,
    featureNames: [...FEATURE_NAMES],
    reviewComplete: input.reviewComplete,
    counts: {
      accepted: input.verdicts.filter((v) => v.verdict === "wall").length,
      rejected: input.verdicts.filter((v) => v.verdict === "not-wall").length,
      traced: traced.length,
      unreviewed: input.unreviewed,
    },
    rows,
    traced: traced.map((t) => ({
      x1: t.x1,
      y1: t.y1,
      x2: t.x2,
      y2: t.y2,
      lengthFeet: t.lengthFeet,
    })),
  };
}
