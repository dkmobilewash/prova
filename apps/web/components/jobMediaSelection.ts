/**
 * Which captures a person has ticked in a gallery, and what a bulk action
 * is therefore allowed to act on.
 *
 * A PLAIN MODULE RATHER THAN STATE INSIDE THE GALLERY, for the reason
 * `lib/photo-report.ts` is one: every rule here is decidable from two
 * arrays, so a test can hold it still without rendering anything. This
 * repo's unit environment does no layout and renders no React
 * (`vitest.config.mts` is `environment: "node"`, `**\/*.test.ts` only), so
 * logic left inside a component is logic nothing can check.
 *
 * THE SELECTION IS A LIST OF IDS, NOT A LIST OF ROWS. A gallery re-renders
 * constantly — every share, every caption edit, every `router.refresh()`
 * hands the component a fresh array of freshly-projected objects — so a
 * selection holding rows would be holding stale copies of records that have
 * since changed. Ids survive that; the rows are looked up again on every
 * read.
 *
 * WHICH MAKES PRUNING THE CENTRAL RULE HERE rather than a tidy-up. The list
 * under the selection moves: a photo is deleted, a filter chip narrows the
 * page, the 60-capture cap drops the oldest one off the end. An id left
 * behind by any of those is an id the person can no longer see, and a bulk
 * action that still carried it would act on something that is not on the
 * screen — which on this feature's other button would be a disclosure
 * nobody chose. So every read and every mutation goes through
 * `pruneSelected` first, and the count on the bar is therefore always the
 * number of ticked boxes actually visible.
 */

/** The least a capture has to be for the rules below to sort it. Structural
 *  rather than the gallery's own row type, so a test can call these with a
 *  two-field object literal — the same split `ReportCapture` makes in
 *  lib/photo-report.ts. */
export type SelectableCapture = {
  id: string;
  /** The job it is filed against. Needed here and not by the card itself:
   *  `/photos` can show several jobs at once, and a photo report is ONE
   *  job's document — see `bulkReportTarget`. */
  jobId: string;
};

/**
 * The selection with everything that is no longer on the page removed.
 *
 * Order follows the ITEMS, not the order things were ticked in, so the
 * captures handed to a bulk action come out in the order the person is
 * looking at them. Duplicates in the stored selection collapse, because the
 * walk is over the items and each item is visited once.
 */
export function pruneSelected(
  selected: readonly string[],
  items: readonly SelectableCapture[],
): string[] {
  const ticked = new Set(selected);
  return items.filter((item) => ticked.has(item.id)).map((item) => item.id);
}

/**
 * Ticks or unticks one capture.
 *
 * Takes the ALREADY-PRUNED selection — the gallery prunes once per render
 * and every handler works from that value — so a toggle is also the moment
 * anything stale finally leaves. Returns a new array rather than mutating:
 * this is React state.
 */
export function toggleSelected(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((each) => each !== id) : [...selected, id];
}

/** Everything on the page, in the page's own order. Deliberately not "every
 *  capture on this job" — the gallery is capped (60 on `/photos`, 12 on a
 *  job page) and a "select all" that reached past what is rendered would
 *  tick boxes nobody can see to untick. */
export function selectEveryVisible(items: readonly SelectableCapture[]): string[] {
  return items.map((item) => item.id);
}

/**
 * What a bulk action may act on.
 *
 * THE CROSS-JOB CASE IS A FIRST-CLASS ANSWER, not an error. `/photos` with
 * no job chip lit is a company-wide gallery, and ticking three photos
 * across two jobs is an entirely reasonable thing to do there — it just
 * cannot become a photo report, because a report is one job's document with
 * that job and its contact in the printed header. Saying so on the bar is
 * the useful behaviour; producing a document headed with one of the two
 * jobs would not be.
 *
 * `ids` is carried on BOTH answers so the bar can state the same number it
 * would have acted on, and the job ids are carried so it can say how many
 * jobs are in the way.
 */
export type BulkReportTarget =
  | { kind: "none" }
  | { kind: "one-job"; jobId: string; ids: string[] }
  | { kind: "many-jobs"; jobIds: string[]; ids: string[] };

export function bulkReportTarget(
  selected: readonly string[],
  items: readonly SelectableCapture[],
): BulkReportTarget {
  // Pruned here too rather than trusting the caller. This is the function
  // that decides what a link puts in a URL, and it is the last place before
  // that happens — an id that reached it from a stale render must not
  // become a capture on somebody's document.
  const ids = pruneSelected(selected, items);
  if (ids.length === 0) return { kind: "none" };

  const ticked = new Set(ids);
  const jobIds: string[] = [];
  for (const item of items) {
    if (ticked.has(item.id) && !jobIds.includes(item.jobId)) jobIds.push(item.jobId);
  }

  return jobIds.length === 1
    ? { kind: "one-job", jobId: jobIds[0], ids }
    : { kind: "many-jobs", jobIds, ids };
}
