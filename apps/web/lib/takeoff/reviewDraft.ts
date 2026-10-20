import type { Candidate, ReviewState, Verdict } from "./answerKeyReview";

/**
 * ── AN IN-PROGRESS REVIEW SURVIVES THE TAB ──
 *
 * Every other thing a user does on a takeoff sheet is written to the database
 * as they do it: a measurement, an edit to a run, a cutout, the scale, an
 * item. The answer-key review was the exception — accept, reject, not sure,
 * split and trace lived only in the open page until somebody pressed Save to
 * labels.
 *
 * On 2026-10-20 a tab was reset mid-sheet, almost certainly killed for
 * memory, and took Central Bank A101 with it: 37 decisions and 49 TRACES,
 * which are the expensive half — a trace is a wall the reviewer found that
 * the finder did not, drawn by hand, two clicks at a time.
 *
 * ── WHY THE BROWSER AND NOT THE SERVER ──
 *
 * A half-finished review is not a label file. Writing it server-side would
 * mean a partial answer key on disk that an audit would read and a training
 * run could pick up, and the save path deliberately refuses a save that
 * replaces a larger review. A draft is the reviewer's own working state, so
 * it belongs in their own browser until they decide it is finished.
 *
 * ── A DRAFT IS ONLY VALID FOR THE CANDIDATES IT WAS MADE ABOUT ──
 *
 * Verdicts are keyed by candidate id, and ids are positional — `w0`, `w1` —
 * so the same id means a different wall the moment the finder changes. The
 * draft therefore carries a FINGERPRINT of the candidate list, and a restore
 * that does not match is refused and SAID, rather than silently applying one
 * sheet's decisions to another's walls. That is the whole reason this file is
 * not three lines of `JSON.stringify`.
 *
 * Pure. No DOM, no storage — `draftStore.ts` does the talking to the browser.
 */

export const DRAFT_FORMAT = "takeoff-review-draft-v1";

export type ReviewDraft = {
  format: typeof DRAFT_FORMAT;
  set: string;
  page: number;
  /** The build that drew the candidates these verdicts are about. */
  finderVersion: string;
  /** Proof the candidate list is the same one — see `fingerprint`. */
  fingerprint: string;
  savedAt: string;
  verdicts: Record<string, Verdict>;
  traced: Candidate[];
  /** For the restore offer, so it can say what is in there before restoring. */
  counts: { decided: number; traced: number };
};

/**
 * A short, stable summary of a candidate list.
 *
 * Count first, because a changed count alone is a certain mismatch. Then the
 * geometry, rounded to a ten-thousandth of the page width — about an eighth
 * of an inch on a 288 ft sheet, far finer than any real difference and coarse
 * enough that a float that re-reads at the last bit does not invalidate an
 * afternoon's work.
 */
export function fingerprint(candidates: readonly Candidate[]): string {
  let hash = 0;
  for (const one of candidates) {
    const parts = `${one.id}|${round(one.x1)},${round(one.y1)},${round(one.x2)},${round(one.y2)}`;
    for (let i = 0; i < parts.length; i += 1) {
      // A plain 32-bit rolling hash: this is a comparison, not a signature,
      // and nothing is being defended against an adversary.
      hash = (hash * 31 + parts.charCodeAt(i)) | 0;
    }
  }
  return `${candidates.length}:${(hash >>> 0).toString(36)}`;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** The key a draft is stored under. One per sheet per finder build. */
export function draftKey(set: string, page: number, finderVersion: string): string {
  return `takeoff-review-draft:${set}:${page}:${finderVersion}`;
}

/**
 * Build a draft from the live review state.
 *
 * Returns null when there is nothing worth keeping, so an untouched sheet
 * does not leave a draft behind that will later offer to restore nothing.
 */
export function draftFrom(input: {
  state: ReviewState;
  set: string;
  page: number;
  finderVersion: string;
  now?: Date;
}): ReviewDraft | null {
  const decided = Object.values(input.state.verdicts).filter((v) => v !== "unreviewed").length;
  const traced = input.state.traced.length;
  // ── WHAT COUNTS AS WORTH KEEPING ──
  //
  // A traced wall ALWAYS counts, even one, because it is the expensive thing:
  // the reviewer found a wall the finder missed and drew it by hand.
  if (decided === 0 && traced === 0) return null;
  return {
    format: DRAFT_FORMAT,
    set: input.set,
    page: input.page,
    finderVersion: input.finderVersion,
    fingerprint: fingerprint(input.state.candidates),
    savedAt: (input.now ?? new Date()).toISOString(),
    verdicts: { ...input.state.verdicts },
    traced: input.state.traced.map((t) => ({ ...t })),
    counts: { decided, traced },
  };
}

export type RestoreResult =
  | { ok: true; state: ReviewState }
  | { ok: false; why: string };

/**
 * Put a draft back onto a freshly started review.
 *
 * `fresh` is what `startReview` just produced for this sheet — including its
 * duplicate pre-marking. The draft's verdicts replace that, because the
 * reviewer's decisions outrank a rule's.
 */
export function restoreDraft(draft: ReviewDraft, fresh: ReviewState): RestoreResult {
  if (draft.format !== DRAFT_FORMAT) {
    return { ok: false, why: "that draft was written by a different version of this screen" };
  }
  const now = fingerprint(fresh.candidates);
  if (now !== draft.fingerprint) {
    // ── REFUSED, AND SAID ──
    //
    // Verdicts are keyed by positional ids, so applying them to a different
    // candidate list would attach one wall's decision to another's — silently,
    // and with every count still looking right.
    return {
      ok: false,
      why:
        `the finder now reads this sheet differently ` +
        `(${fresh.candidates.length} candidates, the draft was about ${draft.fingerprint.split(":")[0]}), ` +
        `so those decisions would land on the wrong walls`,
    };
  }
  const verdicts: Record<string, Verdict> = { ...fresh.verdicts };
  for (const [id, verdict] of Object.entries(draft.verdicts)) {
    // Only ids this review actually has. The fingerprint makes a stray id
    // nearly impossible, and "nearly" is not a reason to write one in.
    if (id in verdicts) verdicts[id] = verdict;
  }
  return {
    ok: true,
    state: { ...fresh, verdicts, traced: draft.traced.map((t) => ({ ...t })) },
  };
}

/** What the restore offer says, before anything is restored. */
export function restoreOffer(draft: ReviewDraft): string {
  const bits: string[] = [];
  if (draft.counts.decided > 0) {
    bits.push(`${draft.counts.decided} decision${draft.counts.decided === 1 ? "" : "s"}`);
  }
  if (draft.counts.traced > 0) {
    bits.push(`${draft.counts.traced} trace${draft.counts.traced === 1 ? "" : "s"}`);
  }
  return `Restore unsaved review (${bits.join(", ")})`;
}

/** Whether a review has anything in it that leaving the page would lose. */
export function hasUnsavedWork(state: ReviewState): boolean {
  return (
    state.traced.length > 0 ||
    Object.values(state.verdicts).some((v) => v !== "unreviewed")
  );
}

/**
 * Keep an existing review when the finder re-offers the SAME candidates.
 *
 * ── A RE-DETECT USED TO WIPE THE SHEET ──
 *
 * `onCandidates` called `startReview` and assigned the result, so anything
 * that made the viewer re-run detection — a redraw, a zoom that reflows, a
 * restore that re-rendered — threw away every decision on the sheet and put
 * the duplicate pre-marking back. No reload was needed and nothing said a
 * word.
 *
 * Found by a reload test that restored 11 decisions and then read 5 off the
 * panel: the restore had worked and a re-detect had landed on top of it.
 *
 * The same fingerprint means the same candidate list in the same order, so
 * the verdicts still belong to the walls they were made about. A different
 * one means the sheet really has been re-read and a fresh review is right.
 */
export function keepReview(existing: ReviewState | null, fresh: ReviewState): ReviewState {
  if (existing === null) return fresh;
  if (fingerprint(existing.candidates) !== fingerprint(fresh.candidates)) return fresh;
  // The duplicate pre-marking comes from `fresh`, and the reviewer's verdicts
  // sit on top — their decision outranks the rule's, which is the same order
  // `restoreDraft` uses.
  const verdicts: Record<string, Verdict> = { ...fresh.verdicts };
  for (const [id, verdict] of Object.entries(existing.verdicts)) {
    if (id in verdicts && verdict !== "unreviewed") verdicts[id] = verdict;
  }
  return { ...fresh, verdicts, traced: existing.traced };
}
