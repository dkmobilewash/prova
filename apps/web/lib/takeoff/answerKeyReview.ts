import { duplicatePairs, type DuplicatePair } from "./duplicateCandidates";
import type { StrokeSegment } from "./wallVectors";
import { type AnswerKey, type KeyWall } from "@/lib/takeoff/answerKey";

/**
 * ── THE STATE OF REVIEWING ONE SHEET ──
 *
 * Making a key means deciding, for every candidate on a sheet, whether it is a
 * wall. The decisions are the whole value, so they live here as data rather
 * than inside a component: a reducer can be tested at every transition, and a
 * component cannot.
 *
 * ── EVERYTHING STARTS UNREVIEWED, WHICH IS THE POINT ──
 *
 * The obvious design is to pre-accept the detector's output and let the
 * reviewer remove what is wrong. That makes a key that agrees with the
 * detector by construction, because nobody deletes 122 rows one at a time —
 * and a key that agrees with the thing it is grading is not a key.
 *
 * So a detected wall arrives as a CANDIDATE. It is on screen, it is one press
 * to accept, and until somebody presses it counts for nothing.
 *
 * ── AND THE SINGLE LINES ARE CANDIDATES TOO ──
 *
 * 7,694 ft of unpaired long lines were measured on A102 and 93% of them
 * classify as hatching. The remaining 7% is the question nobody can answer
 * from geometry, so those lines are offered the same way: one press to accept,
 * one to reject, and the key records which were which.
 */

/**
 * What a reviewer has said about one candidate.
 *
 * ── WHY "unsure" IS NOT JUST "unreviewed" ──
 *
 * They mean opposite things to a training set. `unreviewed` is a candidate
 * nobody looked at, and on a finished sheet it is the commonest NEGATIVE there
 * is — the hatch and grid that never got a glance. `unsure` is a candidate
 * somebody looked at and could not call, and feeding that to a model as either
 * answer teaches it a confidence the reviewer did not have.
 *
 * So an unsure row is SAVED and EXCLUDED: it is in the file, with its feature
 * vector, marked as what it is. If a later model disagrees loudly with a
 * reviewer's "not sure", that is worth reading rather than worth hiding.
 */
export type Verdict = "unreviewed" | "wall" | "not-a-wall" | "unsure";

/** One thing a reviewer is deciding about. */
export type Candidate = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthFeet: number;
  /** Null for a single line, which has no second face to measure against. */
  thicknessIn: number | null;
  /** How the drawing showed it — recorded in the key, and what colours it. */
  from: "pair" | "single";
  /** For a single line, what it looks like — hatching, dashed, and so on. */
  note: string;
};

export type ReviewState = {
  candidates: Candidate[];
  verdicts: Record<string, Verdict>;
  /** One wall offered twice — see `duplicateCandidates.ts`. Empty when the
   *  caller did not supply a scale to measure them in. */
  duplicates: DuplicatePair[];
  /** What the reviewer has traced by hand, already accepted by definition. */
  traced: Candidate[];
  /**
   * ── EVERY SPLIT THE REVIEWER MADE, AS A FACT ──
   *
   * A split replaces one candidate with two halves that the finder never
   * proposed, so reopening a saved sheet cannot re-create them from the
   * verdicts alone. The first attempt INFERRED them — two collinear saved
   * verdicts along one candidate — and that fired on MHK A1.01, a sheet
   * NEVER split: it invented a cut, left a half undecided (38 of 39
   * reviewed), moved accepted footage from 524 to 509, and dropped four
   * duplicate pairs, because `splitCandidate` deletes pairs naming the
   * candidate it replaces.
   *
   * Duplicates and adjacent runs are collinear too. So the split is recorded
   * where it happens and re-applied from the record, never guessed.
   */
  splits: SplitRecord[];
};

/** One split, as the geometry it was made on. */
export type SplitRecord = {
  /** The candidate as it was BEFORE the cut. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthFeet: number;
  thicknessIn: number | null;
  /** Where it was cut. */
  cutX: number;
  cutY: number;
};

export function startReview(
  candidates: readonly Candidate[],
  /** The sheet's scale, so duplicates can be measured in feet. Omit it and
   *  no duplicate is looked for, which is what every existing caller gets. */
  feetPerUnit?: number,
  /** The sheet's own lines, in page-width units, so the duplicate rule can ask
   *  which twin is actually drawn on a wall. Omitted, it falls back to length. */
  segments?: readonly StrokeSegment[],
): ReviewState {
  const verdicts: Record<string, Verdict> = {};
  for (const one of candidates) verdicts[one.id] = "unreviewed";

  // ── THE SHORTER OF A DUPLICATE PAIR STARTS REJECTED ──
  //
  // Not hidden and not decided: it is a visible default the reviewer can flip
  // in one keystroke, and both halves of the pair say so on screen. Starting
  // it `unreviewed` would leave the reviewer to notice two near-identical
  // runs among a hundred and forty, which is what happened on Camp Bow Wow
  // A101 — one pair was caught by eye and one was not, and accepting both
  // bills the wall twice.
  //
  // The longer one is left `unreviewed`, because whether it is a wall at all
  // is still the reviewer's question. All this settles is which of the two
  // offers to answer.
  const duplicates =
    feetPerUnit === undefined || !(feetPerUnit > 0)
      ? []
      : duplicatePairs(candidates, feetPerUnit, segments);
  for (const pair of duplicates) verdicts[pair.drop] = "not-a-wall";

  return { candidates: [...candidates], verdicts, traced: [], duplicates, splits: [] };
}

export function setVerdict(state: ReviewState, ids: readonly string[], verdict: Verdict): ReviewState {
  const next = { ...state.verdicts };
  for (const id of ids) {
    // Only things that are actually on the sheet. A box-select that caught
    // nothing must not invent rows.
    if (id in next) next[id] = verdict;
  }
  return { ...state, verdicts: next };
}

/** A wall the reviewer drew because the detector missed it entirely. */
/**
 * A wall somebody drew by hand, as a candidate the key can hold.
 *
 * ── TRACED IS ACCEPTED BY DEFINITION, AND THAT IS THE WHOLE POINT ──
 *
 * Every other candidate starts `unreviewed` because the app proposed it. This
 * one was drawn by the person whose judgement the key records, so there is
 * nobody left to ask. `keyFromReview` takes the traced list without consulting
 * a verdict for exactly that reason.
 *
 * ── NO THICKNESS, HONESTLY ──
 *
 * Two clicks give a centreline and say nothing about how thick the wall is.
 * `thicknessIn` is null rather than a default, for the reason `candidatesFrom
 * Sheet` gives for an unpaired line: a guess would be in the key for ever, and
 * a key is graded against.
 */
export function tracedWall(
  from: { x: number; y: number },
  to: { x: number; y: number },
  feetPerUnit: number,
  at: number,
): Candidate {
  return {
    id: `t${at}`,
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
    lengthFeet: Math.hypot(to.x - from.x, to.y - from.y) * feetPerUnit,
    thicknessIn: null,
    from: "single",
    note: "traced by hand",
  };
}

export function addTraced(state: ReviewState, wall: Candidate): ReviewState {
  return { ...state, traced: [...state.traced, wall] };
}

export function removeTraced(state: ReviewState, id: string): ReviewState {
  return { ...state, traced: state.traced.filter((w) => w.id !== id) };
}

export type Progress = {
  total: number;
  reviewed: number;
  walls: number;
  notWalls: number;
  unsure: number;
  traced: number;
  /** Feet the key would carry if saved now. */
  feet: number;
};

export function progressOf(state: ReviewState): Progress {
  let reviewed = 0;
  let walls = 0;
  let notWalls = 0;
  let unsure = 0;
  let feet = 0;
  for (const one of state.candidates) {
    const verdict = state.verdicts[one.id] ?? "unreviewed";
    if (verdict === "unreviewed") continue;
    reviewed += 1;
    if (verdict === "wall") {
      walls += 1;
      feet += one.lengthFeet;
    } else if (verdict === "unsure") {
      // Counts as reviewed — the reviewer did look — and carries no footage,
      // because an answer key states what IS a wall and this states that
      // nobody could say.
      unsure += 1;
    } else {
      notWalls += 1;
    }
  }
  for (const one of state.traced) feet += one.lengthFeet;
  return {
    total: state.candidates.length,
    reviewed,
    walls,
    notWalls,
    unsure,
    traced: state.traced.length,
    feet,
  };
}

/** The next thing needing a decision after `afterId`, wrapping once. */
export function nextUnreviewed(state: ReviewState, afterId: string | null): Candidate | null {
  const at = afterId === null ? -1 : state.candidates.findIndex((c) => c.id === afterId);
  const order = [...state.candidates.slice(at + 1), ...state.candidates.slice(0, Math.max(at + 1, 0))];
  return order.find((c) => (state.verdicts[c.id] ?? "unreviewed") === "unreviewed") ?? null;
}

/** Candidates whose midpoint falls inside a drag box, in page-width units. */
export function candidatesInBox(
  state: ReviewState,
  box: { x1: number; y1: number; x2: number; y2: number },
): string[] {
  const minX = Math.min(box.x1, box.x2);
  const maxX = Math.max(box.x1, box.x2);
  const minY = Math.min(box.y1, box.y2);
  const maxY = Math.max(box.y1, box.y2);
  return state.candidates
    .filter((c) => {
      const mx = (c.x1 + c.x2) / 2;
      const my = (c.y1 + c.y2) / 2;
      return mx >= minX && mx <= maxX && my >= minY && my <= maxY;
    })
    .map((c) => c.id);
}

/**
 * The key, as it would be saved right now.
 *
 * ── UNREVIEWED IS NOT ACCEPTED ──
 *
 * Only what somebody said yes to. A half-finished review therefore produces a
 * SHORT key rather than a wrong one, and the progress count is what says it is
 * half-finished — a key that quietly included the undecided would grade every
 * later run against a number nobody stood behind.
 */
export function keyFromReview(
  state: ReviewState,
  about: {
    set: string;
    page: number;
    number: string;
    reviewedBy: string;
    reviewedAt: string;
    feetPerUnit: number;
  },
): AnswerKey {
  const walls: KeyWall[] = [];
  for (const one of state.candidates) {
    if ((state.verdicts[one.id] ?? "unreviewed") !== "wall") continue;
    walls.push({
      x1: one.x1,
      y1: one.y1,
      x2: one.x2,
      y2: one.y2,
      lengthFeet: one.lengthFeet,
      thicknessIn: one.thicknessIn,
      from: one.from,
    });
  }
  for (const one of state.traced) {
    walls.push({
      x1: one.x1,
      y1: one.y1,
      x2: one.x2,
      y2: one.y2,
      lengthFeet: one.lengthFeet,
      thicknessIn: one.thicknessIn,
      from: one.from,
    });
  }
  return {
    sheet: { set: about.set, page: about.page, number: about.number },
    reviewedBy: about.reviewedBy,
    reviewedAt: about.reviewedAt,
    feetPerUnit: about.feetPerUnit,
    walls,
  };
}

/**
 * ── EVERYTHING ON THE SHEET THAT SOMEBODY HAS TO DECIDE ABOUT ──
 *
 * Two populations, deliberately in one list:
 *
 *   - what the detector REPORTED, every row of it a candidate rather than an
 *     answer, so the key cannot agree with the detector by default;
 *   - the long lines with NO partner, which the detector cannot reach at all.
 *     7,694 ft of them on A102, 93% classifying as hatching — and the only way
 *     to learn what the other 7% is, is to ask somebody.
 *
 * Reported walls come first because they are the quicker decisions, and a
 * reviewer who runs out of patience should run out of it on the ambiguous
 * half rather than on the obvious one.
 */
export function candidatesFromSheet(input: {
  walls: readonly { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet: number }[];
  singles: readonly {
    line: { x1: number; y1: number; x2: number; y2: number };
    lengthFeet: number;
    kind: string;
    why: string;
  }[];
}): Candidate[] {
  const out: Candidate[] = [];
  input.walls.forEach((wall, at) => {
    out.push({
      id: `w${at}`,
      x1: wall.x1,
      y1: wall.y1,
      x2: wall.x2,
      y2: wall.y2,
      lengthFeet: wall.lengthFeet,
      thicknessIn: wall.thicknessFeet * 12,
      from: "pair",
      note: "detected",
    });
  });
  input.singles.forEach((single, at) => {
    out.push({
      id: `s${at}`,
      x1: single.line.x1,
      y1: single.line.y1,
      x2: single.line.x2,
      y2: single.line.y2,
      lengthFeet: single.lengthFeet,
      // A single line has no second face, so there is no thickness to record.
      // Saying null is the honest answer; a guess would be in the key for ever.
      thicknessIn: null,
      from: "single",
      note: single.kind,
    });
  });
  return out;
}

/**
 * ── THE COLOUR EACH STATE DRAWS IN, HERE RATHER THAN IN THE PANEL ──
 *
 * They were exported from `AnswerKeyPanel.tsx`, which is a `"use client"`
 * module, and `clientBoundary` refuses a server module importing a non-
 * component value from one. That rule caught an eval reading these to draw an
 * overlay — the right catch: a colour is not a component, and a palette that
 * can only be read by the browser cannot be used by the thing that grades it.
 *
 * Both the panel and the viewer draw from this, so the mark beside a candidate
 * in the rail is the mark on the sheet by construction rather than by two
 * literals agreeing.
 */
export const VERDICT_COLOURS: Record<Verdict, string> = {
  unreviewed: "#f59e0b",
  wall: "#16a34a",
  "not-a-wall": "#9ca3af",
  // Violet: not the amber of "nobody has looked", because somebody has.
  unsure: "#a855f7",
};

/** A single line is offered in its own colour, because it is a different
 *  question: not "is this wall right" but "is this a wall at all". */
export const SINGLE_LINE_COLOUR = "#2563eb";
