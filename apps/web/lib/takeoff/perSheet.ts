/**
 * ── A RESULT BELONGS TO ONE SHEET, AND THIS IS THE ONE PLACE THAT SAYS SO ──
 *
 * The takeoff workspace has now had this bug twice. The first time it was the
 * wall groups: a find on one sheet showed its runs on sheet 30, sheet 52 and
 * S-101, none of which it had anything to do with. That was fixed by keeping
 * the page beside the result, and `wallsOnThisSheet` in `wallGroups.ts` says
 * in as many words why the decision has to live in ONE place that every render
 * site reads.
 *
 * The second time was the answer-key review, the labels, the missed-wall list
 * and the measured view's name — four more page-less states added beside a fix
 * that had already been reasoned out and written down. A find on A120 drew its
 * orange unreviewed candidates across A130 and A140, at A120's coordinates, on
 * drawings with no walls on them at all.
 *
 * So this is the shape, as a function rather than as a convention: a record
 * keyed by page, and a reader that cannot be given the wrong one by accident.
 *
 * ── KEYED RATHER THAN CLEARED ON PAGE CHANGE ──
 *
 * An effect that wipes state when the page changes would also work, and
 * `wallGroups.ts` rejects that for a reason worth repeating: an effect is a
 * thing somebody has to remember, and the next state added beside it will not
 * be in its dependency list. A record cannot be forgotten in that way, because
 * there is nowhere to put a value except under a page.
 *
 * It also makes paging away and back FREE, which matters more here than it did
 * for the groups: an answer-key review is an hour of somebody's judgement, and
 * losing it to a glance at the next sheet would be a worse bug than the one
 * this fixes.
 *
 * ── WHY A FUNCTION AND NOT JUST A RECORD LOOKUP IN THE COMPONENT ──
 *
 * `wallGroups.ts` has the answer, from a mutation that showed nothing could
 * see the bug: `TakeoffPlanViewer` opens on page 1 and its pager only renders
 * once a real PDF reports `numPages`, which never happens in a DOM test. No
 * rendered test can put the viewer on page 2, so page-keying done inline is
 * unobservable from outside. Pulling it out gives it a caller a test can be.
 */

/** What this sheet has, or `fallback` when the value belongs to another. */
export function onThisSheet<T>(byPage: Readonly<Record<number, T>>, page: number): T | null {
  const mine = byPage[page];
  return mine === undefined ? null : mine;
}

/**
 * The record with `next` recorded against `page`, or with that page's entry
 * removed when `next` is null.
 *
 * Null REMOVES rather than storing a null, so `onThisSheet` has one answer for
 * "this sheet has nothing" instead of two.
 */
export function setOnThisSheet<T>(
  byPage: Readonly<Record<number, T>>,
  page: number,
  next: T | null,
): Record<number, T> {
  if (next === null) {
    const rest: Record<number, T> = {};
    for (const [key, value] of Object.entries(byPage)) {
      if (Number(key) !== page) rest[Number(key)] = value;
    }
    return rest;
  }
  return { ...byPage, [page]: next };
}
