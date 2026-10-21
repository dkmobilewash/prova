import { labelRows, type LabelCandidate, type LabelFile } from "./labelRows";
import { UNKNOWN_FINDER, sameFinder } from "./finderVersion";
import { heldOutReason } from "./heldOutSets";
import { trainingRows, type LabelledSheet, type TrainingRowsResult } from "./trainingRows";

/**
 * ── READING A SAVED LABEL FILE BACK INTO TRAINING ROWS ──
 *
 * A label file holds two things: the reviewer's VERDICTS, which are about
 * walls on a drawing and never go stale, and `rows`, which are features of
 * the candidates a particular finder drew and go stale the moment it changes.
 *
 * ── `rows[i]` CORRESPONDS TO `candidates[i]` AND TO NOTHING ELSE ──
 *
 * `labelRows` walks the candidate list in order and pushes one row per
 * candidate, so the correspondence is POSITIONAL. Re-run a later finder and
 * the list is a different length in a different order: on 2026-10-20 Camp Bow
 * Wow A120's saved `21.7 ft / 3.8 in` had become `22.6 ft / 7.7 in` after the
 * view picking and the splitting changed. Training on `rows` paired with
 * today's candidates by index teaches the model the reviewer's verdict about
 * one run as if it were about another — and every count still looks right,
 * which is why this is a function rather than a comment.
 *
 * So rows are REBUILT from the verdicts against the candidates in hand, by
 * the same geometric matching the save used (`belongsTo`: a verdict claims a
 * candidate it overlaps and runs alongside). The verdicts are the durable
 * part; the features are recomputed from whatever finder is running now.
 */

export type CollectedSheet = {
  sheet: LabelledSheet;
  /** What the file says drew its candidates, for the run's report. */
  savedFinder: string;
  /** Whether that is the finder being used now — see `sameFinder`. */
  sameFinder: boolean;
  /** Rows as the file stored them, against rows rebuilt now. */
  storedRows: number;
  rebuiltRows: number;
  /**
   * Why this set is held out, or null.
   *
   * Reported rather than acted on here — `trainingRows` does the refusing.
   * It is on the row because a held-out set IS labelled (its labels are the
   * answer key), so a collector run that silently showed nothing for four
   * sets would look exactly like a run that never had them.
   */
  heldOut: string | null;
};

/**
 * Rebuild one sheet's training rows from its saved verdicts.
 *
 * `candidates` are from the finder running NOW, with its features. Pass the
 * file's own candidates to reproduce what it stored.
 */
export function collectSheet(
  saved: Pick<LabelFile, "set" | "sheet" | "feetPerUnit" | "reviewComplete" | "verdicts"> & {
    /**
     * What the panel offered, where the file records it.
     *
     * ── NOT SHOWN IS NOT REJECTED ──
     *
     * The viewer sets candidates aside before the panel lists them, so a
     * complete sheet can still hold candidates nobody saw. Passed through so
     * `labelRows` can refuse to write those as negatives: measured at 217 of
     * 464 negatives across the nine traced training sheets, and 100 against
     * ONE real rejection on Murray A101.
     */
    counts?: { accepted?: number; rejected?: number; unsure?: number; unreviewed?: number };
    finderVersion?: string;
    /** Only its LENGTH is read — the rows themselves are rebuilt, not reused. */
    rows: readonly unknown[];
  },
  candidates: readonly LabelCandidate[],
  nowFinder: string,
): CollectedSheet {
  const c = saved.counts;
  const offeredCount =
    c === undefined
      ? undefined
      : (c.accepted ?? 0) + (c.rejected ?? 0) + (c.unsure ?? 0) + (c.unreviewed ?? 0);
  const rows = labelRows(
    candidates,
    saved.verdicts,
    saved.feetPerUnit,
    saved.reviewComplete,
    offeredCount,
  );
  const savedFinder = saved.finderVersion ?? UNKNOWN_FINDER;
  return {
    sheet: {
      set: saved.set,
      sheet: saved.sheet,
      rows: rows.map((row) => ({
        features: row.features,
        label: row.label,
        lengthFt: row.lengthFt,
      })),
    },
    savedFinder,
    sameFinder: sameFinder(savedFinder, nowFinder),
    storedRows: saved.rows.length,
    rebuiltRows: rows.length,
    heldOut: heldOutReason(saved.set),
  };
}

/**
 * A whole directory's worth, ready to train on, with the report a run needs.
 *
 * ── IT RETURNS THE REFUSED RESULT, NOT A BARE LIST OF SHEETS ──
 *
 * The first version handed back `sheets: LabelledSheet[]` and left the
 * held-out refusal to whoever called `trainingRows` next, on the reasoning
 * that refusing in two places is how the two stop agreeing. That reasoning is
 * fine and the design was still wrong: nothing FORCED a caller through the
 * refusal, so `collectSheets(...).sheets` was a one-line path from four
 * answer-key sets straight into a training file, and `trainingRowsCensus`
 * caught it the first time the suite ran.
 *
 * So the refusal stays in `trainingRows` — one implementation, as intended —
 * and this returns what that function produced. There is no longer a
 * collected-but-unrefused list to reach for.
 */
export function collectSheets(
  files: ReadonlyArray<{
    saved: Parameters<typeof collectSheet>[0];
    candidates: readonly LabelCandidate[];
  }>,
  nowFinder: string,
): { training: TrainingRowsResult; collected: CollectedSheet[]; staleFinders: number } {
  const collected = files.map((f) => collectSheet(f.saved, f.candidates, nowFinder));
  const sheets: LabelledSheet[] = collected.map((c) => c.sheet);
  return {
    training: trainingRows(sheets),
    collected,
    staleFinders: collected.filter((c) => !c.sameFinder).length,
  };
}
