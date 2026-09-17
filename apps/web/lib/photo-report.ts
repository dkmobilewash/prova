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
 *  the value's name, because the reader of the paper never saw the URL.
 *
 *  "SHARED BY LINK" RATHER THAN "SHARED WITH THE CLIENT", everywhere this
 *  state is named, and the reason is a customer's: the portal link goes to
 *  whoever the sub sends it to — the GC, the architect, an owner's rep —
 *  so "the client" describes the audience too narrowly and makes people
 *  hesitate over whether the control is the right one. What the column
 *  actually records is that the job's portal link shows this capture. */
export function photoReportSelectionLabel(selection: PhotoReportSelection): string {
  switch (selection) {
    case "shared":
      return "Only captures already shared by the job's portal link";
    case "not-shared":
      return "Only captures NOT shared by the job's portal link";
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

/* ------------------------------------------------------------------ *
 * A PICKED SET: the captures somebody ticked in the gallery
 *
 * The second way a report can be built, and it is a different KIND of
 * choice rather than a fourth selection. A selection is a rule ("everything
 * the portal link already shows"); a picked set is a list of captures a
 * person chose one at a time. They cannot compose — a picked set narrowed
 * by `include=shared` would silently drop captures the person had ticked,
 * with nothing on the page or the paper to say which — so `photoReportHref`
 * refuses to write both, and the page reads the ids first.
 * ------------------------------------------------------------------ */

/** What the document is built from: a rule, or a hand-picked list. */
export type PhotoReportContents =
  | { kind: "selection"; selection: PhotoReportSelection }
  | { kind: "picked"; ids: string[] };

/**
 * The `?ids=` query value as a list.
 *
 * DEDUPED AND ORDER-PRESERVING. Deduping is not tidiness: the same id twice
 * would be the same photograph printed twice on a document somebody hands
 * over, and the "you picked N" line underneath would count it twice as
 * well. Order is the gallery's, which is the order the person was looking
 * at them in.
 *
 * NOT CAPPED HERE. The cap belongs to the page, which slices to
 * `PHOTO_REPORT_LIMIT` and then tells the reader how many of the ids it did
 * not use (`photoReportPickedNote`). A parser that capped silently would
 * make that sentence impossible to write, because the number the person
 * asked for would already be gone.
 */
export function parsePhotoReportIds(
  raw: string | readonly string[] | null | undefined,
): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  // A REPEATED QUERY PARAMETER IS AN ARRAY, and this is the first parser on
  // this page that would call a string method on one. `?ids=a&ids=b` is a
  // URL anybody can type, and Next hands a repeated key through as
  // `string[]` — every page in this app declares its `searchParams` values
  // as `string`, which is a narrowing of what actually arrives rather than a
  // guarantee, so TypeScript cannot catch this and did not.
  //
  // The app's other two parameters survive it by accident rather than by
  // design: `parsePhotoReportSelection` asks `includes(raw)` and an array is
  // simply not one of the three selections, and the tag is compared with
  // `===` against an id. Both fall through to their safe default. A bare
  // `raw.split(",")` here would instead have thrown
  // `raw.split is not a function` — which production REDACTS, so the report
  // would have rendered as the error boundary with nothing to say why.
  //
  // Flattened rather than rejected: `?ids=a&ids=b` plainly means both, each
  // element is read as its own comma list, and nothing is trusted by doing
  // so — every id is still scoped to this company and job inside the query.
  for (const part of (Array.isArray(raw) ? raw.join(",") : (raw as string)).split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Which of the two the URL asked for. The ids win when both are present,
 *  which cannot happen from a link this app renders — `photoReportHref`
 *  writes one or the other — and can happen from a hand-edited URL. Ids
 *  win because they are the narrower, explicitly-chosen answer. */
export function photoReportContents(
  ids: readonly string[],
  include: string | null | undefined,
): PhotoReportContents {
  return ids.length > 0
    ? { kind: "picked", ids: [...ids] }
    : { kind: "selection", selection: parsePhotoReportSelection(include) };
}

/**
 * What the printed header says a picked document contains.
 *
 * The COUNT is the number of captures actually on the paper, not the number
 * of ids in the URL, for the reason every other sentence on this document
 * states what it is rather than what was asked for. When those two numbers
 * differ, `photoReportPickedNote` says so underneath.
 */
export function photoReportPickedLabel(shown: number): string {
  // Zero is not the plural branch. "0 captures, picked from the gallery" is
  // what the general form produces, and it is both ungrammatical and wrong
  // about what happened — nothing was picked zero times; what was picked is
  // not on this job. Found by clicking a picked report at another job's id,
  // which is exactly how a reader reaches this branch.
  if (shown === 0) return "None of the captures you picked";
  return shown === 1
    ? "One capture, picked from the gallery"
    : `${shown} captures, picked from the gallery`;
}

/** The header sentence for either kind, so the page never chooses between
 *  two labels itself. */
export function photoReportContentsLabel(contents: PhotoReportContents, shown: number): string {
  return contents.kind === "picked"
    ? photoReportPickedLabel(shown)
    : photoReportSelectionLabel(contents.selection);
}

/**
 * A PICKED SET IS ALWAYS INTERNAL, and that is the same conservative
 * judgement `photoReportIsInternal` already makes rather than a new one.
 *
 * The tempting alternative is to look at the rows: if every picked capture
 * happens to be shared already, drop the banner. That is exactly the
 * reading the selection version refuses, and it is worse here — the ids sit
 * in a URL somebody can bookmark, mail to themselves, or open a week later,
 * by which time the sharing state of any of them may have changed and the
 * banner would appear or vanish on data the person printing is not looking
 * at. Anything that is not literally "the set the portal link already
 * shows" carries the banner.
 */
export function photoReportContentsIsInternal(contents: PhotoReportContents): boolean {
  return contents.kind === "picked" || photoReportIsInternal(contents.selection);
}

/**
 * The line a picked document prints when it does not hold everything that
 * was picked, or null when it does.
 *
 * TWO CAUSES, ONE SENTENCE, because from the reader's side they are the
 * same fact: something that was ticked is not on this paper. A capture can
 * be missing because it was deleted (or moved job, or was never this
 * company's — the query is scoped and an id that does not match simply
 * returns nothing), or because the pick ran past `PHOTO_REPORT_LIMIT`.
 * Stating only one of them would be a confident half-answer.
 *
 * ON THE PAPER, like `photoReportCapNote`, for the same reason: a document
 * read months later must not let its reader believe they are holding
 * everything that was chosen.
 */
export function photoReportPickedNote(shown: number, picked: number): string | null {
  if (picked <= shown) return null;
  return (
    `${shown} of the ${picked} captures picked for this report are on it. ` +
    `The rest are no longer on this job, or are past the ${PHOTO_REPORT_LIMIT}-capture limit.`
  );
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
 *
 * A PICKED SET REPLACES BOTH FILTERS RATHER THAN JOINING THEM, and that is
 * enforced here rather than left to each caller. `?ids=…&include=shared`
 * would be a document that prints fewer captures than the person ticked,
 * with no way for them to tell which ones went. One question per URL.
 */
export function photoReportHref(
  jobId: string,
  filter: {
    selection?: PhotoReportSelection | null;
    tag?: string | null;
    /** The captures somebody ticked in the gallery. When this is non-empty
     *  it is the whole of the document's contents and the other two fields
     *  are not written. */
    ids?: readonly string[] | null;
  } = {},
): string {
  const params = new URLSearchParams();
  if (filter.ids && filter.ids.length > 0) {
    params.set("ids", filter.ids.join(","));
  } else {
    if (filter.selection && filter.selection !== PHOTO_REPORT_DEFAULT_SELECTION) {
      params.set("include", filter.selection);
    }
    if (filter.tag) params.set("tag", filter.tag);
  }
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
