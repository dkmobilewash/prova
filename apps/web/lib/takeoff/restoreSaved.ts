import type { Candidate, ReviewState, SplitRecord, Verdict } from "./answerKeyReview";
import { addTraced, setVerdict, tracedWall } from "./answerKeyReview";
import { splitCandidate } from "./splitCandidate";

/**
 * ── REOPENING A SHEET THAT HAS ALREADY BEEN LABELLED ──
 *
 * Until this existed the labelling page could only start from nothing. There
 * was a `POST` to write a label file and NO `GET` to read one, so coming back
 * to a sheet to add a few traces meant deciding all 200 candidates again — and
 * the only reason that had not cost a day was that nobody had tried.
 *
 * ── MATCHED BY GEOMETRY, NOT BY POSITION ──
 *
 * `reviewDraft.ts` restores a localStorage draft by FINGERPRINT: the candidate
 * list must be identical, because a draft stores ids and an id is a position.
 * That is right for a draft written seconds ago and wrong here. A saved file
 * can be weeks old, written by an older finder, and it stores COORDINATES — so
 * a verdict is matched to the candidate that occupies the same wall, which
 * survives the list being reordered, lengthened or renumbered.
 *
 * The band is the scorer's own: half the thicker wall plus a margin, floored
 * at 1.5 ft and capped at 3. A centre line and a face are the same wall, and
 * `heldOutScore.ts` says why at length.
 *
 * ── IT REFUSES RATHER THAN RESTORE HALF A REVIEW ──
 *
 * If the finder's output has moved enough that most saved decisions no longer
 * land on anything, a partial restore is the worst outcome available: the
 * reviewer sees a sheet that looks reviewed, with an unknown number of
 * verdicts silently missing, and saves it back over the good file. So the
 * result is all or nothing, and the refusal says how many of how many matched.
 */

/** Below this share of saved decisions matching, nothing is restored. */
export const MIN_MATCH_SHARE = 0.9;

export const SAME_WALL_FEET = 1.5;
export const FACE_MARGIN_FEET = 0.5;
export const MAX_BAND_FEET = 3;

export type SavedVerdict = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthFeet: number;
  thicknessFeet?: number;
  verdict: string;
};

export type SavedSheet = {
  set?: string;
  sheet?: string;
  page?: number;
  feetPerUnit?: number;
  finderVersion?: string;
  /** Who reviewed it. The save writes this; the restore has to give it back —
   *  see the `reviewedBy` note on `RestoreSavedResult`. */
  reviewedBy?: string;
  reviewerKind?: string;
  /** The splits the reviewer made, when the file is new enough to have them. */
  splits?: SplitRecord[];
  verdicts?: SavedVerdict[];
};

export type RestoreSavedResult =
  | {
      ok: true;
      state: ReviewState;
      /**
       * ── WHY THE RESTORE HAS TO HAND BACK THE REVIEWER'S NAME ──
       *
       * The Save button is `disabled={savingLabels || reviewer.trim() === ""}`.
       * A restore that leaves the name box empty therefore reopens a sheet
       * with SAVE DEAD — which is what happened on MHK A1.01: the review came
       * back cleanly, eleven traces were added, and the button did nothing
       * because a text box three inches away was blank. Nothing about the
       * review was wrong and nothing said so.
       */
      reviewedBy: string | null;
      reviewerKind: string | null;
      /** Splits re-created before matching, so their halves' verdicts fit. */
      splitsReapplied: number;
      /**
       * ── THE SAVED VERDICTS THAT MATCHED NOTHING, KEPT VERBATIM ──
       *
       * These are decisions a person made that no current candidate fits:
       * the finder has moved since the file was written, and the label files
       * on this machine span SEVEN finder builds. Dropping them on the next
       * save would destroy reviewed work silently, which is the one outcome
       * worse than refusing to restore.
       *
       * So they come back out here, exactly as they went in, and the save
       * writes them again beside the new work with the build they came from.
       */
      carried: SavedVerdict[];
      /** The splits the file recorded, passed through so a save keeps them. */
      carriedSplits: SplitRecord[];
      /** The build that wrote the file these came from. */
      sourceFinderVersion: string | null;
      /**
       * Below `MIN_MATCH_SHARE` the review is restored anyway, but as a
       * TRACE-ONLY sheet: too few decisions fit to judge candidates against,
       * so the reviewer adds traces and the save merges. The page must say so
       * — a partial restore that looks complete is the thing the floor was
       * protecting against.
       */
      traceOnly: boolean;
      /** For the sentence the page shows: what came back. */
      decisions: number;
      traces: number;
      /** Saved decisions that matched no candidate — zero in the happy path. */
      unmatched: number;
      message: string;
    }
  | { ok: false; message: string };

const len = (a: { x1: number; y1: number; x2: number; y2: number }) =>
  Math.hypot(a.x2 - a.x1, a.y2 - a.y1);

function offLine(
  a: { x1: number; y1: number; x2: number; y2: number },
  px: number,
  py: number,
  feetPerUnit: number,
): number {
  const L = len(a);
  if (L === 0) return Math.hypot(px - a.x1, py - a.y1) * feetPerUnit;
  const num = Math.abs((a.x2 - a.x1) * (a.y1 - py) - (a.x1 - px) * (a.y2 - a.y1));
  return (num / L) * feetPerUnit;
}

function parallel(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  const la = len(a);
  const lb = len(b);
  if (la === 0 || lb === 0) return false;
  const dot =
    ((a.x2 - a.x1) / la) * ((b.x2 - b.x1) / lb) + ((a.y2 - a.y1) / la) * ((b.y2 - b.y1) / lb);
  return Math.abs(dot) > 0.985;
}

function bandFeet(a: { thicknessFeet?: number }, b: { thicknessFeet?: number }): number {
  const thickest = Math.max(a.thicknessFeet ?? 0, b.thicknessFeet ?? 0);
  return Math.min(MAX_BAND_FEET, Math.max(SAME_WALL_FEET, thickest / 2 + FACE_MARGIN_FEET));
}

/** Where b's ends fall along a, in feet from a's start. */
function along(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
  feetPerUnit: number,
): { lo: number; hi: number } {
  const L = len(a);
  if (L === 0) return { lo: 0, hi: 0 };
  const ux = (a.x2 - a.x1) / L;
  const uy = (a.y2 - a.y1) / L;
  const t1 = ((b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy) * feetPerUnit;
  const t2 = ((b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy) * feetPerUnit;
  return { lo: Math.min(t1, t2), hi: Math.max(t1, t2) };
}

const DECIDED: Record<string, Verdict> = {
  wall: "wall",
  "not-wall": "not-a-wall",
  "not-a-wall": "not-a-wall",
  unsure: "unsure",
};

/**
 * The candidate a saved decision is about, or null.
 *
 * Nearest wins among those inside the band, so two parallel walls a band
 * apart cannot swap verdicts by iteration order.
 */
export function candidateFor(
  saved: SavedVerdict,
  candidates: readonly Candidate[],
  feetPerUnit: number,
  taken: ReadonlySet<string>,
): Candidate | null {
  let best: { candidate: Candidate; off: number } | null = null;
  for (const c of candidates) {
    if (taken.has(c.id)) continue;
    if (!parallel(saved, c)) continue;
    const band = bandFeet(saved, { thicknessFeet: c.thicknessIn === null ? 0 : c.thicknessIn / 12 });
    const off = Math.max(
      offLine(saved, c.x1, c.y1, feetPerUnit),
      offLine(saved, c.x2, c.y2, feetPerUnit),
    );
    if (off > band) continue;
    // Length has to agree too: a 3 ft run lying on a 40 ft wall is not that
    // wall, and without this a short candidate would claim a long decision.
    const longer = Math.max(saved.lengthFeet, c.lengthFeet, 1e-9);
    if (Math.abs(saved.lengthFeet - c.lengthFeet) / longer > 0.35) continue;
    if (best === null || off < best.off) best = { candidate: c, off };
  }
  return best === null ? null : best.candidate;
}

/**
 * ── THE PIECES OF A SPLIT CANDIDATE DO NOT EXIST ON REOPENING ──
 *
 * A reviewer can cut a candidate in two and judge each half. The file holds a
 * verdict per HALF, and neither half is a candidate the finder proposes, so
 * reopening has to re-create them or those verdicts match nothing.
 *
 * ── THE FIRST VERSION GUESSED, AND GUESSING WAS WRONG ──
 *
 * It inferred a split from two collinear saved verdicts lying along one
 * candidate. Duplicates and adjacent runs are collinear too. On MHK A1.01 —
 * a sheet NEVER split — it invented a cut: 38 of 39 reviewed with one half
 * left undecided, accepted footage down from 524 to 509, and the duplicate
 * box from five pairs to one, because `splitCandidate` drops pairs naming the
 * candidate it replaces. Every one of those numbers looked like a finder
 * change and none of them was.
 *
 * So splits are RECORDED where they are made (`ReviewState.splits`, written
 * into the label file) and re-applied from the record.
 *
 * ── AND FOR FILES WRITTEN BEFORE THE RECORD EXISTED ──
 *
 * Inference is allowed only when it cannot be anything else:
 *
 *   - the two pieces ABUT, with no gap and no overlap;
 *   - they have the SAME thickness, which two different walls rarely do;
 *   - together they equal exactly ONE current candidate — same length within
 *     a hand's width, and both outer ends on that candidate's own ends.
 *
 * Anything short of that is left alone and counted, so the caller can say how
 * many verdicts went unmatched instead of a cut being invented to absorb
 * them. A stale verdict is a number somebody can check; a wrong split is a
 * sheet that looks right.
 */
const ABUT_FEET = 0.25;
const SAME_LENGTH_FEET = 0.5;
const SAME_THICKNESS_IN = 0.5;

export function reapplySplits(
  saved: readonly SavedVerdict[],
  state: ReviewState,
  feetPerUnit: number,
  recorded: readonly SplitRecord[] = [],
): { state: ReviewState; splits: number; declined: number } {
  let working = state;
  let splits = 0;
  let declined = 0;

  // ── RECORDED SPLITS FIRST, AND THEY NEED NO AGREEMENT FROM THE VERDICTS ──
  for (const record of recorded) {
    const target = working.candidates.find((c) => {
      if (!parallel(record, c)) return false;
      if (Math.abs(record.lengthFeet - c.lengthFeet) > SAME_LENGTH_FEET) return false;
      const off = Math.max(
        offLine(c, record.x1, record.y1, feetPerUnit),
        offLine(c, record.x2, record.y2, feetPerUnit),
      );
      return off <= 1.5;
    });
    if (target === undefined) {
      declined += 1;
      continue;
    }
    const out = splitCandidate(working, target.id, { x: record.cutX, y: record.cutY }, feetPerUnit);
    if (out.halves === null) {
      declined += 1;
      continue;
    }
    working = out.state;
    splits += 1;
  }

  if (recorded.length > 0) return { state: working, splits, declined };

  // ── NO RECORD: INFER ONLY WHAT CANNOT BE ANYTHING ELSE ──
  // Why a split was declined, when asked. Off by default: this is a
  // diagnostic for the strictness, not output anybody needs in the app.
  const say = (c: Candidate, reason: string) => {
    if (process.env.RESTORE_WHY !== undefined) {
      console.log(`      declined on ${c.lengthFeet.toFixed(1)} ft candidate: ${reason}`);
    }
  };

  const decided = saved.filter((v) => DECIDED[v.verdict] !== undefined);
  for (const candidate of working.candidates) {
    if ((working.verdicts[candidate.id] ?? "unreviewed") !== "unreviewed") continue;
    const candidateThicknessIn = candidate.thicknessIn;

    const pieces = decided
      .filter((v) => parallel(v, candidate))
      .filter((v) => {
        const off = Math.max(
          offLine(candidate, v.x1, v.y1, feetPerUnit),
          offLine(candidate, v.x2, v.y2, feetPerUnit),
        );
        return off <= 1.5;
      })
      .filter((v) => v.lengthFeet < candidate.lengthFeet - ABUT_FEET)
      .map((v) => ({ v, span: along(candidate, v, feetPerUnit) }))
      .sort((a, b) => a.span.lo - b.span.lo);

    if (pieces.length !== 2) {
      if (pieces.length > 2) {
        declined += 1;
        say(candidate, `${pieces.length} collinear pieces, not 2`);
      }
      continue;
    }
    const [first, second] = pieces;

    // They must ABUT: no gap, no overlap.
    if (Math.abs(second.span.lo - first.span.hi) > ABUT_FEET) {
      declined += 1;
      say(candidate, `gap of ${(second.span.lo - first.span.hi).toFixed(2)} ft between the pieces`);
      continue;
    }
    // Same thickness. A piece recorded with no thickness cannot be compared,
    // so it is declined rather than assumed to match.
    const ta = first.v.thicknessFeet;
    const tb = second.v.thicknessFeet;
    if (ta === undefined || tb === undefined || Math.abs(ta - tb) * 12 > SAME_THICKNESS_IN) {
      declined += 1;
      say(candidate, `piece thicknesses ${((ta ?? 0) * 12).toFixed(1)} vs ${((tb ?? 0) * 12).toFixed(1)} in`);
      continue;
    }
    if (
      candidateThicknessIn !== null &&
      Math.abs(ta * 12 - candidateThicknessIn) > SAME_THICKNESS_IN
    ) {
      declined += 1;
      say(candidate, `pieces are ${(ta * 12).toFixed(1)} in, candidate is ${candidateThicknessIn.toFixed(1)} in`);
      continue;
    }
    // Together they must equal exactly this candidate: the right total length,
    // and both outer ends on its own ends.
    const total = second.span.hi - first.span.lo;
    if (Math.abs(total - candidate.lengthFeet) > SAME_LENGTH_FEET) {
      declined += 1;
      say(candidate, `pieces total ${total.toFixed(1)} ft, candidate is ${candidate.lengthFeet.toFixed(1)} ft`);
      continue;
    }
    if (Math.abs(first.span.lo) > ABUT_FEET) {
      declined += 1;
      say(candidate, `first piece starts ${first.span.lo.toFixed(2)} ft in, not at the end`);
      continue;
    }
    if (Math.abs(second.span.hi - candidate.lengthFeet) > ABUT_FEET) {
      declined += 1;
      say(candidate, `second piece ends ${(candidate.lengthFeet - second.span.hi).toFixed(2)} ft short`);
      continue;
    }

    const cutFeet = first.span.hi;
    const t = cutFeet / Math.max(candidate.lengthFeet, 1e-9);
    const out = splitCandidate(
      working,
      candidate.id,
      {
        x: candidate.x1 + (candidate.x2 - candidate.x1) * t,
        y: candidate.y1 + (candidate.y2 - candidate.y1) * t,
      },
      feetPerUnit,
    );
    if (out.halves === null) {
      declined += 1;
      continue;
    }
    working = out.state;
    splits += 1;
  }

  return { state: working, splits, declined };
}

export function restoreSaved(
  saved: SavedSheet,
  fresh: ReviewState,
  feetPerUnit: number,
): RestoreSavedResult {
  const all = saved.verdicts ?? [];
  if (all.length === 0) {
    return { ok: false, message: "That sheet has a saved file, but it holds no decisions." };
  }

  const decisions = all.filter((v) => DECIDED[v.verdict] !== undefined);
  const traces = all.filter((v) => v.verdict === "traced");

  // Splits first: they change the candidate list the match reads.
  const prepared = reapplySplits(all, fresh, feetPerUnit, saved.splits ?? []);

  const taken = new Set<string>();
  const pairs: { saved: SavedVerdict; candidate: Candidate }[] = [];
  let unmatched = 0;
  for (const v of decisions) {
    const hit = candidateFor(v, prepared.state.candidates, feetPerUnit, taken);
    if (hit === null) {
      unmatched += 1;
      continue;
    }
    taken.add(hit.id);
    pairs.push({ saved: v, candidate: hit });
  }

  // ── BELOW THE FLOOR IS TRACE-ONLY, NOT NOTHING ──
  //
  // This refused outright, which was right while a save would have DROPPED
  // the verdicts that did not match. Now the save keeps them verbatim, so
  // refusing costs the reviewer the matched work for no gain. The sheet comes
  // back with what fits, says what does not, and is for tracing.
  const traceOnly = decisions.length > 0 && pairs.length / decisions.length < MIN_MATCH_SHARE;

  let state = prepared.state;
  for (const { saved: v, candidate } of pairs) {
    state = setVerdict(state, [candidate.id], DECIDED[v.verdict]);
  }
  traces.forEach((t, index) => {
    // A trace was drawn by hand and belongs to no candidate, so it is rebuilt
    // from its own two endpoints exactly as the reviewer left it. `at` is the
    // index that makes its id unique, which is why it is passed rather than
    // defaulted.
    state = addTraced(
      state,
      tracedWall({ x: t.x1, y: t.y1 }, { x: t.x2, y: t.y2 }, feetPerUnit),
    );
  });

  const carried = decisions.filter((v) => !pairs.some((p) => p.saved === v));

  return {
    ok: true,
    state,
    carried,
    carriedSplits: [...(saved.splits ?? [])],
    sourceFinderVersion: typeof saved.finderVersion === "string" ? saved.finderVersion : null,
    traceOnly,
    reviewedBy: typeof saved.reviewedBy === "string" && saved.reviewedBy !== "" ? saved.reviewedBy : null,
    reviewerKind: typeof saved.reviewerKind === "string" && saved.reviewerKind !== "" ? saved.reviewerKind : null,
    splitsReapplied: prepared.splits,
    decisions: pairs.length,
    traces: traces.length,
    unmatched,
    // ── BOTH BRANCHES LEAD WITH WHAT CAME BACK ──
    //
    // This branch used to open on what did NOT match, and never said the word
    // "Restored" at all. Chrome reported Bunkie A100 as "restored silently":
    // 64 decisions and 3 traces came back, and the only sentence on screen was
    // about the 19 that did not. The reviewer's question when they reopen a
    // sheet is "is my work here", and the answer was in the second clause of a
    // sentence that began with bad news.
    //
    // The threshold is untouched — below `MIN_MATCH_SHARE` the sheet really is
    // for tracing. Only the order of the telling changes.
    message: traceOnly
      ? `Restored ${pairs.length} saved decision${pairs.length === 1 ? "" : "s"}` +
        (traces.length > 0 ? ` and ${traces.length} trace${traces.length === 1 ? "" : "s"}` : "") +
        (prepared.splits > 0 ? `, ${prepared.splits} split re-applied` : "") +
        `. ${carried.length} more ${carried.length === 1 ? "is" : "are"} kept but not shown: ` +
        `the candidates they were about have moved` +
        (saved.finderVersion === undefined
          ? ""
          : ` since finder ${saved.finderVersion.slice(0, 12)}`) +
        `. ${pairs.length} of ${decisions.length} still fit, so this sheet is for TRACING — ` +
        `add what the finder missed and save; nothing already decided is lost.`
      : `Restored ${pairs.length} saved decision${pairs.length === 1 ? "" : "s"}` +
      (traces.length > 0 ? ` and ${traces.length} trace${traces.length === 1 ? "" : "s"}` : "") +
      (prepared.splits > 0 ? `, ${prepared.splits} split re-applied` : "") +
      // ── ONLY WORTH SAYING IF SOMETHING IS ACTUALLY MISSING ──
      //
      // A decline means "two collinear decisions sat along a candidate and
      // this would not infer a cut from them", which on an unsplit sheet is
      // the ordinary state of any wall with a neighbour: Crosslines A100
      // reported 27 and NG A3.2 eleven, both with ZERO unmatched decisions
      // and nothing wrong. A line that fires when everything restored
      // perfectly teaches the reader to ignore it, and then it is worth
      // nothing on the day it matters.
      (prepared.declined > 0 && unmatched > 0
        ? `, ${prepared.declined} possible split not re-applied (not provable)`
        : "") +
        (unmatched > 0 ? `, ${unmatched} kept but not shown — their candidates moved` : "") +
        ". Add what is missing and save again.",
  };
}
