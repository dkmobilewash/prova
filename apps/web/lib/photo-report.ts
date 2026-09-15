/**
 * What goes on a printed site-photo report, and what the document says
 * about itself.
 *
 * Pure and session-free, the same split `lib/job-media.ts` makes against
 * its query module and `lib/permissions.ts` makes against `lib/authz.ts`:
 * every rule here is decidable without a database and a test can hold it
 * still. The page imports rather than restates — a second copy of the
 * "which captures are on this document" rule is how `LOCATION_TYPES` came
 * to disagree with its own Prisma enum (CLAUDE.md).
 *
 * THE DOCUMENT IS A DISCLOSURE, WHICH IS WHY THE SELECTION IS A FIRST-CLASS
 * THING AND NOT A DEFAULT. A job's gallery holds another trade's damage
 * kept for a backcharge, the unsafe condition documented defensively, and
 * the crew's own mistake before it was put right — the same three examples
 * `media.prisma` gives for why client sharing is opt-in one file at a time.
 * A report that quietly swept all three into a PDF somebody emails to a GC
 * would undo that safeguard in one click, so this module makes three
 * decisions instead of none:
 *
 *   1. THE DEFAULT IS THE ALREADY-DISCLOSED SET. No parameter, no chip
 *      clicked, a bare `/jobs/<id>/photo-report` — that is the captures the
 *      client can already see through their portal link. Widening it is a
 *      deliberate act with a different URL.
 *   2. THE DOCUMENT STATES ITS OWN SELECTION, in words, in the header, so
 *      the sentence travels with the paper after it has left the app.
 *   3. AN INTERNAL SELECTION SAYS SO IN A BANNER. `photoReportIsInternal`
 *      is the whole of that judgement and it is deliberately conservative:
 *      anything that is not exactly "the shared set" counts as internal,
 *      including a selection that happens to contain nothing but shared
 *      captures on the day it was printed.
 */

/**
 * Which of a job's captures the report is built from.
 *
 * A STRING UNION RATHER THAN A BOOLEAN, for the reason `SharedFilter` in
 * lib/job-media-tags.ts is one: every filter on these pages is composed
 * with `if (x) params.set(...)`, and a boolean `false` is falsy — so "the
 * ones the client has NOT seen" would be silently dropped and the document
 * would answer a different question while looking entirely healthy. All
 * three members here are truthy.
 *
 * A SEPARATE UNION FROM `SharedFilter`, AND THAT IS THE POINT RATHER THAN
 * DUPLICATION. The two have DIFFERENT DEFAULTS: on `/photos` an absent
 * filter means "show me everything", and on a document an absent filter
 * means "only what the client has already been shown". Sharing one type
 * across two opposite defaults is how somebody eventually reuses
 * `parseSharedFilter` here and silently turns the safe default into the
 * unsafe one, with nothing on the page to say so. Different question,
 * different vocabulary, and "everything" is spelled out rather than being
 * the absence of a value.
 */
export const PHOTO_REPORT_SELECTIONS = ["shared", "not-shared", "everything"] as const;

export type PhotoReportSelection = (typeof PHOTO_REPORT_SELECTIONS)[number];

/** No parameter means the already-disclosed set — see the module comment.
 *  Exported so the page cannot spell a different default by hand. */
export const PHOTO_REPORT_DEFAULT_SELECTION: PhotoReportSelection = "shared";

/**
 * A `?include=` query value, or the safe default.
 *
 * Anything unrecognised — a stale link, a hand-edited URL, a typo — falls
 * back to the DEFAULT rather than to "everything". That is the opposite
 * posture from `/photos`, which falls back to "no filter", and the
 * difference is deliberate: on a gallery an unrecognised filter must not
 * quietly withhold photos, and on a document an unrecognised filter must
 * not quietly publish them. Fail toward the smaller disclosure.
 */
export function parsePhotoReportSelection(raw: string | null | undefined): PhotoReportSelection {
  return (PHOTO_REPORT_SELECTIONS as readonly string[]).includes(raw ?? "")
    ? (raw as PhotoReportSelection)
    : PHOTO_REPORT_DEFAULT_SELECTION;
}

/**
 * The three-valued flag `loadJobMediaForReport` wants.
 *
 * `undefined` is "both", and it has to be spelled out rather than fall out
 * of a truthiness test: `false` is a real filter here and means the
 * opposite of "not filtered". This is the same trap
 * `job-media-sharing.dbtest.ts` executes against the gallery, arriving from
 * the other direction.
 */
export function photoReportSharedFlag(selection: PhotoReportSelection): boolean | undefined {
  switch (selection) {
    case "shared":
      return true;
    case "not-shared":
      return false;
    case "everything":
      return undefined;
  }
}

/** What the printed header says this document contains. Prose rather than
 *  the value's name, because the reader of the paper never saw the URL. */
export function photoReportSelectionLabel(selection: PhotoReportSelection): string {
  switch (selection) {
    case "shared":
      return "Only captures already shared with the client";
    case "not-shared":
      return "Only captures NOT shared with the client";
    case "everything":
      return "Every capture on this job";
  }
}

/**
 * Does this document contain anything the client has not already been
 * shown?
 *
 * JUDGED ON THE SELECTION, NOT ON THE ROWS, and that is the safer of the
 * two readings rather than the lazier one. Judging on the rows would mean
 * an "everything" report of a job whose captures all happen to be shared
 * prints with no banner — and then one unshared photo is added, the same
 * URL is printed again, and the banner appears or does not depending on
 * data the person printing is not looking at. The selection is what the
 * person chose; it is stable, and it is what the banner is about.
 */
export function photoReportIsInternal(selection: PhotoReportSelection): boolean {
  return selection !== "shared";
}

/**
 * The report's two filters, composed into one URL.
 *
 * A function rather than a template string at each link, for the reason
 * `photosFilterHref` is one: a link that quietly drops the other filter
 * produces a document with MORE on it than was asked for, which looks
 * exactly like a working page. Here that failure mode publishes photographs.
 *
 * The default selection is omitted from the query string rather than
 * written into it, so the bare URL and the explicitly-safe URL are the same
 * document and neither can drift from the other.
 */
export function photoReportHref(
  jobId: string,
  filter: { selection?: PhotoReportSelection | null; tag?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (filter.selection && filter.selection !== PHOTO_REPORT_DEFAULT_SELECTION) {
    params.set("include", filter.selection);
  }
  if (filter.tag) params.set("tag", filter.tag);
  const query = params.toString();
  return query ? `/jobs/${jobId}/photo-report?${query}` : `/jobs/${jobId}/photo-report`;
}

/**
 * The report selection a gallery's own client-visibility filter leads to.
 *
 * `/photos` and this document ask the same question with different
 * vocabularies and, crucially, DIFFERENT DEFAULTS — so the translation is a
 * function with a test rather than a ternary in a link. The mapping of the
 * two real values is obvious; the third is the decision:
 *
 *   "yes"  -> "shared"
 *   "no"   -> "not-shared"
 *   null   -> the SAFE DEFAULT, not "everything".
 *
 * An unfiltered gallery means "show me everything on this job", and the
 * naive translation of that is an everything REPORT — a printable document
 * of the backcharge evidence and the crew's own mistakes, produced by
 * somebody who clicked a link rather than chose a disclosure. Narrowing is
 * the right direction to be wrong in: the report's own chips are one click
 * away and they say what they widen to.
 */
export function selectionFromSharedFilter(
  shared: "yes" | "no" | null | undefined,
): PhotoReportSelection {
  if (shared === "yes") return "shared";
  if (shared === "no") return "not-shared";
  return PHOTO_REPORT_DEFAULT_SELECTION;
}

/**
 * How many captures one document carries.
 *
 * Capped for the same reason both galleries are, and the reason bites
 * harder on paper: a hundred photographs is roughly a hundred pages and
 * several hundred megabytes of images pulled by a browser that is trying to
 * open a print dialog. Generous enough that a real job's shared set fits.
 */
export const PHOTO_REPORT_LIMIT = 100;

/**
 * The line the document prints when it is not showing everything it
 * matched, or null when it is.
 *
 * ON THE PAPER, not only on the screen. A capped document that says nothing
 * is a document whose reader believes they are holding the whole record —
 * and this one may be read months later by somebody who was not there when
 * it was printed. Same honesty the galleries' "showing the 60 most recent
 * of N" line has, moved to where it survives being printed.
 */
export function photoReportCapNote(shown: number, total: number): string | null {
  if (total <= shown) return null;
  return (
    `This report shows the ${shown} most recent of ${total} matching captures. ` +
    `Narrow it by tag, or open the job in Prova for the rest.`
  );
}

/** The least a capture has to be for the rules below to sort it. Kept
 *  structural rather than importing the query's row type, so this module
 *  stays testable with a two-field object literal. */
export type ReportCapture = {
  kind: "photo" | "video" | "audio";
  dayLabel: string;
};

/**
 * Photographs on one side, everything that cannot be printed on the other.
 *
 * WHY THE UNPRINTABLE ONES ARE NOT DROPPED, which is the decision this
 * function exists to make rather than an implementation detail. Video and
 * voice notes are real evidence on this job — `/photos` accepts a `.mov`
 * and an `.m4a` precisely so a walk-through of a riser is kept somewhere
 * other than a foreman's phone — and paper cannot hold either. There are
 * two defensible answers and only one of them is honest:
 *
 *   - DROP THEM SILENTLY. The document then implies the job's record is
 *     these photographs, and the reader has no way to know a clip exists.
 *     A GC handed this in a dispute would reasonably say the sub disclosed
 *     everything they had.
 *   - LIST THEM. The document says a clip exists, when it was taken and
 *     what it was captioned, and that it has to be watched in Prova.
 *
 * The second one costs a few lines of type at the end of the report and
 * makes the document's silence about them impossible. It is also the same
 * call `jobMediaPlaybackWarning` already makes for a `.mov` a browser
 * cannot play: say what the reader cannot see rather than let them assume
 * they have seen it.
 *
 * ORDER IS PRESERVED WITHIN EACH SIDE, so a caller that has already ordered
 * for the document does not have to order again.
 */
export function partitionPrintable<T extends ReportCapture>(
  captures: T[],
): { printable: T[]; notPrintable: T[] } {
  const printable: T[] = [];
  const notPrintable: T[] = [];
  for (const capture of captures) {
    (capture.kind === "photo" ? printable : notPrintable).push(capture);
  }
  return { printable, notPrintable };
}

/**
 * The document's order: oldest first.
 *
 * OPPOSITE TO EVERY GALLERY IN THE APP, deliberately. A gallery is a place
 * you check what just happened, so newest-first is right; a report is read
 * front to back as an account of a job, and an account that starts at the
 * end and works backwards is not one. Existing conditions before the crew
 * started belong on page one.
 *
 * The QUERY still reads newest-first, because the cap has to keep the most
 * recent captures rather than the oldest hundred a job ever took — so the
 * reversal is here, after the cap, and this function is what makes the
 * combination of the two a stated rule instead of an accident of a
 * `.reverse()` somewhere in a page.
 *
 * Copies rather than reversing in place: the caller's array is a query
 * result that other code on the page may also be reading.
 */
export function oldestFirst<T>(captures: T[]): T[] {
  return [...captures].reverse();
}

/**
 * The document's captures, broken into the days they were taken on.
 *
 * A HEADING PER DAY IS WHAT MAKES THIS A REPORT RATHER THAN A CONTACT
 * SHEET. "What did the west wall look like on the 4th" is the question
 * asked of one of these six months later, and a run of photographs with
 * individual timestamps under them does not answer it at a glance.
 *
 * Grouped on the already-formatted `dayLabel` rather than on a `Date`,
 * because the day a capture belongs to is the day in the VIEWER's zone —
 * `capturedAt` is an instant, not the UTC-midnight calendar date this
 * schema stores elsewhere (see `formatCapturedAt`). Doing the zone
 * arithmetic here would mean a second place that can get it wrong.
 *
 * Consecutive runs only, never a lookup by day: the input is already
 * ordered, and gathering non-adjacent captures under one heading would
 * silently reorder the document. If two runs ever share a label the
 * grouping shows two runs, which is the honest rendering of an input that
 * was not ordered the way this function was promised.
 */
export function groupByDay<T extends ReportCapture>(
  captures: T[],
): { day: string; captures: T[] }[] {
  const groups: { day: string; captures: T[] }[] = [];
  for (const capture of captures) {
    const last = groups[groups.length - 1];
    if (last && last.day === capture.dayLabel) {
      last.captures.push(capture);
    } else {
      groups.push({ day: capture.dayLabel, captures: [capture] });
    }
  }
  return groups;
}
