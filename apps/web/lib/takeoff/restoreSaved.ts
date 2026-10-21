import type { Candidate, ReviewState, Verdict } from "./answerKeyReview";
import { addTraced, setVerdict, tracedWall } from "./answerKeyReview";

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
  verdicts?: SavedVerdict[];
};

export type RestoreSavedResult =
  | {
      ok: true;
      state: ReviewState;
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

  const taken = new Set<string>();
  const pairs: { saved: SavedVerdict; candidate: Candidate }[] = [];
  let unmatched = 0;
  for (const v of decisions) {
    const hit = candidateFor(v, fresh.candidates, feetPerUnit, taken);
    if (hit === null) {
      unmatched += 1;
      continue;
    }
    taken.add(hit.id);
    pairs.push({ saved: v, candidate: hit });
  }

  // ── ALL OR NOTHING ──
  if (decisions.length > 0 && pairs.length / decisions.length < MIN_MATCH_SHARE) {
    return {
      ok: false,
      message:
        `The saved review does not fit this sheet any more: ${pairs.length} of ${decisions.length} ` +
        `saved decisions still match a candidate the finder proposes now` +
        (saved.finderVersion === undefined
          ? ""
          : `. It was saved by finder ${saved.finderVersion.slice(0, 12)}`) +
        `. Nothing was restored — re-review the sheet, or label it on the build that saved it.`,
    };
  }

  let state = fresh;
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
      tracedWall({ x: t.x1, y: t.y1 }, { x: t.x2, y: t.y2 }, feetPerUnit, state.traced.length + index),
    );
  });

  return {
    ok: true,
    state,
    decisions: pairs.length,
    traces: traces.length,
    unmatched,
    message:
      `Restored ${pairs.length} saved decision${pairs.length === 1 ? "" : "s"}` +
      (traces.length > 0 ? ` and ${traces.length} trace${traces.length === 1 ? "" : "s"}` : "") +
      (unmatched > 0 ? `, ${unmatched} no longer matching any candidate` : "") +
      ". Add what is missing and save again.",
  };
}
