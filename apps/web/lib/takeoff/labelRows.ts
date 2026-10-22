import { FEATURE_NAMES } from "./wallFeatures";
import type { SplitRecord } from "./answerKeyReview";
import { finderVersion } from "./finderVersion";

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

/**
 * ── A ROW'S IDENTITY IS ITS GEOMETRY ──
 *
 * Rows needed an id so a row could be carried beside the verdict it came
 * from. The obvious route — thread a candidate id down from the panel —
 * means new plumbing through three components and a new field nobody else
 * reads.
 *
 * The geometry already IS the identity: the whole restore matches saved
 * verdicts to candidates by it, and a verdict in the same file carries the
 * same four numbers. So the id is those numbers, rounded hard enough to
 * survive a round trip through JSON and no further.
 *
 * It is NOT stable across finder builds, and must not be used as if it were:
 * a build that moves a wall by an inch gives it a different id, which is
 * exactly the drift the geometry match exists to absorb. This links a row to
 * a verdict WITHIN one file.
 */
export function geometryId(at: { x1: number; y1: number; x2: number; y2: number }): string {
  const n = (v: number) => v.toFixed(5);
  return `${n(at.x1)},${n(at.y1)},${n(at.x2)},${n(at.y2)}`;
}

export type LabelCandidate = {
  /** Page-width units, as the finder works in. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthFeet: number;
  thicknessFeet: number;
  features: number[];
  /**
   * Was this candidate OFFERED to the reviewer?
   *
   * ── "NOT SHOWN" IS NOT "REJECTED" ──
   *
   * The viewer triages candidates before the panel lists them: its own
   * contract says "only unclassified lines are offered, which took A102 from
   * 168 blue candidates to 2". A candidate it sets aside is never seen, so it
   * carries no verdict — and the `no-run` branch below writes a candidate
   * with no verdict as a CONFIDENT NEGATIVE as soon as the sheet is complete.
   * The sheet IS complete: the reviewer judged every candidate they were
   * offered.
   *
   * Measured on the nine training sheets with traces: 217 of 464 negatives
   * were `no-run`, against 247 real rejections. On Murray A101 the reviewer
   * rejected ONE candidate and the rows carried 100 machine-made negatives.
   *
   * Absent on every file written before this existed, which `labelRows`
   * handles separately — see `offeredCount`.
   */
  offered?: boolean;
};

export type LabelVerdict = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthFeet: number;
  thicknessFeet: number;
  /** What the reviewer said about this run. */
  verdict: "wall" | "not-wall" | "traced" | "unsure";
};

export type LabelRow = {
  /**
   * The candidate this row was derived from.
   *
   * ── WHY A ROW NEEDS AN IDENTITY ──
   *
   * A row was `{features, from, label, lengthFt}` — no id and no geometry —
   * so it could not be matched to the verdict it came from. That made
   * "keep the features of the decisions this build cannot show" impossible
   * to honour on a reopen: the only link available was LENGTH, and guessing
   * by length is what invented a split on MHK A1.01.
   *
   * With the id, a later reopen can carry a row beside its verdict instead
   * of keeping the whole previous block wholesale.
   *
   * Optional because every file written before this exists without it, and
   * those must still read.
   */
  id?: string;
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
  /**
   * Who did the labelling, as a kind rather than a name.
   *
   * ── AN AI SESSION'S MINUTES ARE NOT A PERSON'S MINUTES ──
   *
   * The panel's clock sums the gaps BETWEEN decisions and drops any gap over
   * six minutes as idle, which is right for somebody working through a sheet
   * and wrong for a model: it reads the whole drawing first and then presses
   * keys in bursts, so the reading is thrown away as idle and the batches are
   * counted as instants. On E Street 421 it reported 3m26s for a session that
   * took far longer.
   *
   * So the kind is recorded beside the time, and `secondsSpent` from an AI
   * session is not a measurement of what the work costs. Nothing stops a
   * reader averaging the two together except knowing which is which, which is
   * why this field exists rather than a convention about names.
   */
  reviewerKind: "human" | "ai";
  /**
   * The build of the finder that drew the candidates these verdicts judge.
   *
   * Not decoration. The candidate list is NOT stable across finder changes —
   * Camp Bow Wow A120's saved `21.7 ft / 3.8 in` had become `22.6 ft / 7.7 in`
   * by the afternoon of 2026-10-20 — so `rows` below corresponds to THIS
   * build's candidates and to no other. See `finderVersion.ts`, including why
   * a `-dirty` value is not an identity.
   */
  finderVersion: string;
  /**
   * Seconds of wall-clock the reviewer spent with this sheet open.
   *
   * Only comparable across sessions of the same `reviewerKind` — see above.
   */
  secondsSpent: number;
  feetPerUnit: number;
  featureNames: string[];
  /**
   * The splits the reviewer made, as geometry — absent on files written
   * before this existed, which is why the restore has a strict fallback.
   */
  splits: readonly SplitRecord[];
  /**
   * The previous file's training rows, kept whole under the build that made
   * them, because a row carries no id or geometry and so cannot be matched to
   * the verdict it came from. One generation only.
   */
  carriedRows: { finderVersion: string | null; rows: readonly unknown[] } | null;
  reviewComplete: boolean;
  /** `unsure` is REVIEWED and excluded; `unreviewed` is nobody looked. They
   *  were one field once and the file could not tell them apart. */
  counts: {
    accepted: number;
    rejected: number;
    traced: number;
    unsure: number;
    unreviewed: number;
  };
  rows: LabelRow[];
  /**
   * ── WHAT THE REVIEWER ACTUALLY DECIDED, KEPT AS THEY DECIDED IT ──
   *
   * The `rows` above are DERIVED: one per pairing, with a label and a feature
   * vector and no geometry. That is what a trainer wants and it throws away
   * what a person did — which run they accepted, which they rejected, which
   * they could not call.
   *
   * The first version of this file format stored only the rows, so Camp Bow
   * Wow A101's twenty-six minutes of work could not be revisited, audited or
   * corrected: there was no way to ask "which were the 48 unsure ones" except
   * to review the sheet again. A label set nobody can re-open is a label set
   * nobody can fix, and the first thing anyone wanted to do with the first
   * real sheet was fix it.
   */
  verdicts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    lengthFeet: number;
    thicknessFeet: number;
    verdict: "wall" | "not-wall" | "traced" | "unsure";
  }[];
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
/**
 * ── WHY AN OLDER FILE NEEDS A COUNT RATHER THAN A FLAG ──
 *
 * A file written before `offered` existed cannot say WHICH candidates were
 * shown. But it records how many were: `counts.accepted + rejected + unsure +
 * unreviewed` is the size of the list the panel worked through. When that is
 * smaller than the number of pairings, some were set aside and there is no
 * way to tell which — so no `no-run` negative from that sheet is safe, and
 * all of them are dropped.
 *
 * Conservative in the direction that matters: a dropped negative costs the
 * model one unverified example, and a kept one teaches it that a wall a
 * reviewer never saw is not a wall.
 */
export function labelRows(
  candidates: readonly LabelCandidate[],
  verdicts: readonly LabelVerdict[],
  feetPerUnit: number,
  reviewComplete: boolean,
  /** How many candidates the panel offered, where the file records it. */
  offeredCount?: number,
): LabelRow[] {
  // Some candidates were withheld and the file cannot say which: then no
  // `no-run` negative from this sheet can be trusted.
  const someWithheld = offeredCount !== undefined && offeredCount < candidates.length;
  // ── AN UNSURE RUN REMOVES ITS PAIRINGS FROM THE FILE ──
  //
  // It is not a negative and it is not a positive. The first version of this
  // never received unsure verdicts at all, so a reviewer's 48 "not sure" runs
  // on Camp Bow Wow A101 fell through to the `no-run` branch below and were
  // written as 483 confident NEGATIVES — the precise thing the verdict exists
  // to prevent, and invisible in the file, which recorded them only as a
  // count of 48 "unreviewed".
  //
  // `reviewComplete` is why the fall-through was silent: unsure counts as
  // reviewed, so the sheet was complete, so "no run covers this" meant "the
  // reviewer saw it and did not call it a wall". For an unsure run that
  // reading is false.
  const judged = verdicts.filter((v) => v.verdict !== "traced");
  const unsure = verdicts.filter((v) => v.verdict === "unsure");
  // ── A TRACED WALL ALSO REMOVES THE PAIRINGS UNDER IT ──
  //
  // Same shape as the unsure case above, in the same branch, fixed for one
  // and not the other. A traced run is excluded from `judged`, so a candidate
  // lying along one used to fall through to `no-run` and be written as a
  // CONFIDENT NEGATIVE — the model taught "no wall here" at the one place the
  // reviewer went out of their way to say there is one.
  //
  // It matters most on the held-out buildings, where tracing is the whole
  // point: their keys must contain the walls the finder missed.
  const traced = verdicts.filter((v) => v.verdict === "traced");
  const rows: LabelRow[] = [];
  for (const candidate of candidates) {
    // A candidate can lie under more than one run; an ACCEPTED one wins,
    // because the reviewer said that wall is real and this pairing is part of
    // how it was found.
    let best: LabelVerdict | null = null;
    for (const run of judged) {
      if (run.verdict === "unsure") continue;
      if (!belongsTo(run, candidate, feetPerUnit)) continue;
      if (best === null || (run.verdict === "wall" && best.verdict !== "wall")) best = run;
    }
    if (best === null) {
      if (!reviewComplete) continue;
      // ── NEVER OFFERED, SO NEVER REJECTED ──
      if (candidate.offered === false) continue;
      if (candidate.offered === undefined && someWithheld) continue;
      // Nothing judged it, but something UNSURE lies along it: leave it out.
      if (unsure.some((run) => belongsTo(run, candidate, feetPerUnit))) continue;
      // Or a TRACED wall, which is a positive statement that a wall is here.
      if (traced.some((run) => belongsTo(run, candidate, feetPerUnit))) continue;
      rows.push({
        id: geometryId(candidate),
        features: candidate.features,
        label: 0,
        lengthFt: candidate.lengthFeet,
        from: "no-run",
      });
      continue;
    }
    rows.push({
      id: geometryId(candidate),
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
  /**
   * The splits the reviewer made, as geometry.
   *
   * Without these, reopening a sheet has to GUESS which verdicts are halves
   * of a candidate — and guessing invented a split on MHK A1.01, a sheet
   * never split, costing 15 ft of accepted footage and four duplicate pairs.
   */
  splits?: readonly SplitRecord[];
  /**
   * ── VERDICTS FROM AN EARLIER BUILD, KEPT RATHER THAN DROPPED ──
   *
   * A reopen matches saved verdicts to the candidates the finder proposes
   * NOW, and the files on this machine span seven finder builds — so some
   * decisions fit nothing any more. Writing the file without them would
   * destroy reviewed work silently, every time somebody added one trace to an
   * older sheet.
   *
   * They are written back exactly as they were, each tagged with the build
   * that produced the candidate it judged, so a later reader can tell which
   * geometry it can trust against which finder.
   */
  carried?: readonly (LabelVerdict & { finderVersion?: string })[];
  /**
   * The previous file's training rows.
   *
   * ── WHY WHOLESALE AND NOT PER VERDICT ──
   *
   * A row is `{features, from, label, lengthFt}` — no id and no geometry — so
   * a row CANNOT be matched to the verdict it came from. Carrying "the rows
   * for the unmatched verdicts" is therefore not expressible in this format,
   * and pretending otherwise would mean guessing by length, which is the kind
   * of inference that invented a split on MHK A1.01.
   *
   * So the previous file's rows are kept whole, under the build that made
   * them, and the current build's rows are written as usual. One generation
   * only: a sheet reopened ten times must not accumulate ten copies.
   */
  carriedRows?: { finderVersion: string | null; rows: readonly unknown[] } | null;
  secondsSpent: number;
  /** Overrides the environment; the app leaves it out and gets the build. */
  finderVersion?: string;
  feetPerUnit: number;
  reviewComplete: boolean;
  candidates: readonly LabelCandidate[];
  verdicts: readonly LabelVerdict[];
  unreviewed: number;
}): LabelFile {
  const rows = labelRows(input.candidates, input.verdicts, input.feetPerUnit, input.reviewComplete);
  const traced = input.verdicts.filter((v) => v.verdict === "traced");
  // Carried verdicts go in beside the new work. They are NOT given to
  // `labelRows`: there is no candidate for them on this build, so no feature
  // row can honestly be derived — see `carriedRows`.
  const carried = (input.carried ?? []).map((v) => ({ ...v }));
  /** New work and carried work together: what the file will actually hold. */
  const everything = [...input.verdicts, ...carried];
  return {
    format: "takeoff-labels-v1",
    set: input.set,
    sheet: input.sheet,
    page: input.page,
    reviewedBy: input.reviewedBy,
    reviewedAt: new Date().toISOString(),
    reviewerKind: reviewerKindOf(input.reviewedBy),
    finderVersion: input.finderVersion ?? finderVersion(),
    secondsSpent: Math.round(input.secondsSpent),
    feetPerUnit: input.feetPerUnit,
    featureNames: [...FEATURE_NAMES],
    splits: [...(input.splits ?? [])],
    carriedRows: input.carriedRows ?? null,
    reviewComplete: input.reviewComplete,
    counts: {
      // ── COUNTED WITH THE CARRIED ONES ──
      //
      // A file whose `counts` ignore the verdicts it also contains is a file
      // that argues with itself, and every census here reads the counts.
      // ── ONE LIST, COUNTED ONCE ──
      //
      // The first version of this added `carried` to `accepted` and left the
      // other three counting the new work alone, so a file could hold a
      // carried rejection and report zero rejections. Every census here reads
      // `counts`, and a file that argues with itself is worse than one that
      // is merely incomplete. Counted off a single array so they cannot drift
      // apart again.
      accepted: everything.filter((v) => v.verdict === "wall").length,
      rejected: everything.filter((v) => v.verdict === "not-wall").length,
      traced: everything.filter((v) => v.verdict === "traced").length,
      unsure: everything.filter((v) => v.verdict === "unsure").length,
      unreviewed: input.unreviewed,
    },
    rows,
    verdicts: [
      ...input.verdicts.map((v) => ({
        x1: v.x1,
        y1: v.y1,
        x2: v.x2,
        y2: v.y2,
        lengthFeet: v.lengthFeet,
        thicknessFeet: v.thicknessFeet,
        verdict: v.verdict,
      })),
      // ── CARRIED FROM AN EARLIER BUILD, TAGGED WITH IT ──
      //
      // Written back exactly as they were read, each naming the build whose
      // candidate it judged, so a later reader can tell which geometry it can
      // trust against which finder. Dropping them is how one added trace
      // would destroy an hour of somebody's decisions.
      ...carried.map((v) => ({
        x1: v.x1,
        y1: v.y1,
        x2: v.x2,
        y2: v.y2,
        lengthFeet: v.lengthFeet,
        thicknessFeet: v.thicknessFeet,
        verdict: v.verdict,
        finderVersion: v.finderVersion,
      })),
    ],
    traced: traced.map((t) => ({
      x1: t.x1,
      y1: t.y1,
      x2: t.x2,
      y2: t.y2,
      lengthFeet: t.lengthFeet,
    })),
  };
}

/**
 * Whether a reviewer name is a person or a model.
 *
 * Derived from the name rather than asked for, because the name is what the
 * panel already collects and a second field would be one more thing to get
 * wrong at the moment of saving. The names in use are "AI-Claude-Chrome" and
 * a person's own; anything naming Claude, GPT, a bot or an agent is a model.
 *
 * Wrong in the safe direction by design: a person called "Roboto" is recorded
 * as AI and their time is left out of a cost estimate, which loses one data
 * point. The other way round puts a model's batched keystrokes into an
 * estimate of what labelling costs a person, which is a number somebody would
 * plan with.
 */
export function reviewerKindOf(reviewedBy: string): "human" | "ai" {
  return /\b(?:ai|claude|gpt|llm|bot|agent|automated|robot)\b/i.test(reviewedBy) ||
    /^ai[-_]/i.test(reviewedBy.trim())
    ? "ai"
    : "human";
}
