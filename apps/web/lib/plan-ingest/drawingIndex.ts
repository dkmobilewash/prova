import type { PlanPageText } from "./planPdf";

/**
 * ── WHAT THE SET SAYS IT CONTAINS, AGAINST WHAT ARRIVED ──
 *
 * Every commercial set prints its own index: a table of sheet numbers and
 * titles, usually on the cover. `sheetIndex.ts` already knows what pages we
 * HAVE and spots a number used twice. Nothing has ever checked the other
 * direction — that the set lists a sheet nobody uploaded a page for.
 *
 * That is the one an estimator pays for. A bid priced off an incomplete set is
 * not a bid that comes in low, it is a bid that wins and then meets a drawing
 * nobody read.
 *
 * ── MEASURED ON SIX REAL SETS BEFORE ANY OF THIS WAS WRITTEN ──
 *
 * Three discriminators were tried in order, and the numbers are why the third
 * one is here:
 *
 * | set | pages | sheet-number-shaped | + a title beside it | IN TALL COLUMNS |
 * | --- | --- | --- | --- | --- |
 * | Naples | 52 | 52 | 52 | **52** |
 * | Augusta | 55 | 56 | 56 | **55** |
 * | Pittsburgh Zoo | 27 | 27 | 27 | **27** |
 * | SRFR | 93 | 101 | 101 | **93** |
 * | Alden Green | 38 | 36 | 36 | 32 |
 * | West Herr | 52 | 0 | 0 | **0 — no text layer** |
 *
 * The shape alone over-counts: a legend of drawing symbols (`F1`, `W1`, `GL-1`,
 * `EQP-1`, `FIN-1`) reads exactly like a sheet number. Requiring a TITLE beside
 * it changed nothing at all, because a legend is a table too — that was the
 * obvious fix and it is worthless, which is why the table above records it.
 *
 * What does work: **an index is a COLUMN.** Its numbers share an x-position
 * down the page, and a legend's handful sits somewhere else. Clustering by x
 * and keeping the biggest column got SRFR and Augusta exactly right and broke
 * Naples (52 -> 18), because a wide index is laid out as SEVERAL columns side
 * by side. Keeping every column comparable in size to the tallest fixes that
 * and still drops the legend.
 *
 * ── THE INDEX IS NOT ALWAYS ON PAGE ONE ──
 *
 * Augusta's is on page 2 and SRFR's is on page 2. Scanning only the cover found
 * nothing on either. So the first few pages are scanned and the best one wins.
 *
 * ── AND THE CASE THAT MATTERS MOST IS THE ONE THAT FINDS NOTHING ──
 *
 * West Herr's cover carries NO TEXT LAYER — it is a raster scan, and no amount
 * of parsing will read it. `readDrawingIndex` returns `null` there, and the
 * difference between `null` and "an index listing nothing" is the whole point:
 * one says *we could not check*, the other says *nothing is missing*. Reporting
 * the second when the first is true is the vacuous green this repo keeps paying
 * for. Callers must not collapse them, and `compareIndex` cannot be called
 * without one.
 */

/** A sheet number on a US commercial set: a discipline letter or two, a number,
 *  optionally dotted or dashed. `A-1.1`, `AD0.1`, `M-101`, `S2.03`, `G000A`. */
const SHEET_NUMBER = /^[A-Z]{1,3}-?\d{1,3}(?:[.-]\d{1,3})?[A-Z]?$/;

/** How many pages from the front to look at. Augusta's index is on 2 and
 *  SRFR's on 2; nothing measured has had one deeper than that, and scanning a
 *  whole 93-page set to find a table on page 2 is work for nothing. */
export const INDEX_PAGES_TO_SCAN = 6;

/** A column is as wide as a left-aligned sheet number, as a fraction of the
 *  sheet. Wider merges the index with the title column beside it. */
const COLUMN_TOLERANCE = 0.012;

/** A real index column stands comparison with the tallest one. A legend's
 *  five or six entries do not. */
const COLUMN_SHARE = 0.25;

export type DrawingIndex = {
  /** Which page it was read off — worth showing, because it is often not 1. */
  pageNumber: number;
  /** The sheet numbers the set lists, in the order they appear. */
  listed: string[];
};

/**
 * The index a set prints for itself, or `null` when none could be read.
 *
 * `null` means UNKNOWN, never "complete". See this file's header.
 */
export function readDrawingIndex(pages: readonly PlanPageText[]): DrawingIndex | null {
  let best: DrawingIndex | null = null;

  for (const page of pages.slice(0, INDEX_PAGES_TO_SCAN)) {
    const hits = page.items
      .map((item) => ({ str: item.str.trim(), x: item.x, y: item.y }))
      .filter((item) => SHEET_NUMBER.test(item.str));
    if (hits.length === 0) continue;

    const tolerance = Math.max(1, page.widthPt * COLUMN_TOLERANCE);
    const columns = new Map<number, typeof hits>();
    for (const hit of hits) {
      const key = Math.round(hit.x / tolerance);
      const column = columns.get(key);
      if (column) column.push(hit);
      else columns.set(key, [hit]);
    }

    let tallest = 0;
    for (const column of columns.values()) tallest = Math.max(tallest, column.length);
    // At least three, so two stray labels that happen to share an x are not an
    // index — and at least a quarter of the tallest, which is what drops a
    // legend sitting beside a real index on the same page.
    const floor = Math.max(3, tallest * COLUMN_SHARE);
    const kept = [...columns.values()].filter((column) => column.length >= floor);

    // Down the page, then across — the order somebody reading the sheet sees.
    const ordered = kept
      .flat()
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .map((hit) => hit.str);
    const listed = [...new Set(ordered)];
    if (listed.length >= 3 && (best === null || listed.length > best.listed.length)) {
      best = { pageNumber: page.pageNumber, listed };
    }
  }

  return best;
}

export type IndexComparison = {
  /** Listed in the set's own index, with no page carrying that number. */
  missing: string[];
  /** A page is here that the index does not list. Not an error on its own —
   *  an addendum sheet arrives exactly like this — but worth showing. */
  unlisted: string[];
  listedCount: number;
  haveCount: number;
};

/** Normalised for comparison only: a set is not consistent about `A1.1` against
 *  `A-1.1`, and an estimator does not care. Never shown — what is shown is what
 *  the drawing printed. */
function key(sheetNumber: string): string {
  return sheetNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * What the index lists against what arrived.
 *
 * Takes the index rather than `DrawingIndex | null` on purpose: there is no
 * sensible comparison against an index nobody could read, and accepting null
 * here would let a caller turn "could not check" into an empty `missing` list.
 */
export function compareIndex(index: DrawingIndex, sheetNumbers: readonly (string | null)[]): IndexComparison {
  const have = new Map<string, string>();
  for (const number of sheetNumbers) {
    const trimmed = (number ?? "").trim();
    if (trimmed) have.set(key(trimmed), trimmed);
  }
  const listed = new Map<string, string>();
  for (const number of index.listed) listed.set(key(number), number);

  const missing: string[] = [];
  for (const [k, shown] of listed) if (!have.has(k)) missing.push(shown);

  const unlisted: string[] = [];
  for (const [k, shown] of have) if (!listed.has(k)) unlisted.push(shown);

  return { missing, unlisted, listedCount: listed.size, haveCount: have.size };
}

/**
 * One sentence for the screen.
 *
 * `null` for the index is its own sentence and NOT an absence: a reader who is
 * told nothing concludes nothing is wrong, which is the one conclusion that is
 * never safe here.
 */
export function indexSentence(index: DrawingIndex | null, comparison: IndexComparison | null): string {
  if (index === null || comparison === null) {
    return "Couldn't read this set's own drawing index — the front pages carry no selectable text. Check the sheet list against the index by eye.";
  }
  const { missing, unlisted, listedCount } = comparison;
  const where = index.pageNumber === 1 ? "the cover" : `page ${index.pageNumber}`;
  if (missing.length === 0 && unlisted.length === 0) {
    return `The index on ${where} lists ${listedCount} sheets and all ${listedCount} are here.`;
  }
  const parts: string[] = [`The index on ${where} lists ${listedCount} sheets.`];
  if (missing.length > 0) {
    parts.push(
      `${missing.length} ${missing.length === 1 ? "is" : "are"} NOT in what was uploaded: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? `, and ${missing.length - 12} more` : ""}.`,
    );
  }
  if (unlisted.length > 0) {
    parts.push(
      `${unlisted.length} uploaded ${unlisted.length === 1 ? "sheet is" : "sheets are"} not in the index (an addendum looks like this): ${unlisted.slice(0, 8).join(", ")}${unlisted.length > 8 ? `, and ${unlisted.length - 8} more` : ""}.`,
    );
  }
  return parts.join(" ");
}

/** A sheet as the review screen stores it: what the machine proposed, and what
 *  a person said it is. */
export type ProposedSheet = {
  proposedSheetNumber: string | null;
  acceptedSheetNumber: string | null;
};

/**
 * How many pages of the set still have no sheet number.
 *
 * PURE, because the two ways to get this wrong both live in a Server Action
 * that nothing could test, and mutation found both of them green:
 *
 *   - feeding a constant zero, which is the production bug straight back;
 *   - counting PROPOSALS rather than NUMBERED ones, so a page the model read
 *     and could not name counts as read. That page's sheet is then reported
 *     missing, which is this bug wearing a different hat.
 *
 * `pageCount` is one row per page — `PlanSheetText`, which `sheetIndexFor`
 * builds the review screen's population from. Proposals exist only for pages
 * `TITLE_BLOCK` has reached.
 */
export function unreadPageCount(pageCount: number, sheets: readonly ProposedSheet[]): number {
  const numbered = sheets.filter(
    (sheet) => ((sheet.acceptedSheetNumber ?? sheet.proposedSheetNumber) ?? "").trim() !== "",
  ).length;
  // NEVER NEGATIVE. More proposals than pages means a page carries two — a
  // re-run of the reader — and that is not a reason to claim unread pages.
  return Math.max(0, pageCount - numbered);
}

export type IndexCheckResult = {
  sentence: string;
  /** Null means the set's index COULD NOT BE READ — never "nothing missing". */
  missing: string[] | null;
  unlisted: string[] | null;
  onPage: number | null;
};

/**
 * The whole answer, from the index and the sheets — pure, so the two decisions
 * that matter are testable without a PDF or a database.
 *
 * BOTH OF THEM WERE FOUND BY MUTATION, green against every screen test:
 *
 *   - comparing against `proposedSheetNumber` alone reports a person's OWN
 *     correction as a missing sheet. The accepted number wins, exactly as
 *     `effectiveSheetNumber` reads it on the screen beside this.
 *   - returning an empty `missing` for an index nobody could read says
 *     "nothing is missing" when the truth is "we could not check". That is the
 *     one conclusion that is never safe here, and `null` is how it stays
 *     unsayable.
 */
export function indexCheck(
  index: DrawingIndex | null,
  sheets: readonly ProposedSheet[],
  unreadPages = 0,
): IndexCheckResult {
  if (index === null) {
    return { sentence: indexSentence(null, null), missing: null, unlisted: null, onPage: null };
  }

  // ── A PAGE NOBODY HAS READ IS NOT A MISSING SHEET ──
  //
  // Found on production the day this shipped. Reading had paused at 21 of 55
  // sheets, so 34 pages had no number yet — and every sheet the index listed
  // for them came back as NOT IN WHAT WAS UPLOADED. The screen named twelve
  // real drawings, said "and 27 more", and every one of them was sitting in
  // the file.
  //
  // This is the distinction this module was built around, applied in the
  // wrong direction. It was careful that "the index could not be read" must
  // never read as "nothing is missing" — and then let "the PAGES have not
  // been read" read as "everything is missing", which is the same error
  // pointing the other way and louder.
  //
  // So the comparison is refused outright rather than qualified. Half an
  // answer here is worse than none: an estimator who is told four sheets are
  // missing goes to the GC, and finding them in the file is how a check stops
  // being read at all.
  if (unreadPages > 0) {
    return {
      sentence:
        `${unreadPages} sheet${unreadPages === 1 ? "" : "s"} in this set ${unreadPages === 1 ? "has" : "have"} not been read yet, ` +
        `so this can't tell you what is missing — anything unread would be reported as absent. ` +
        `Let the reading finish, then check again.`,
      missing: null,
      unlisted: null,
      onPage: index.pageNumber,
    };
  }

  const numbers = sheets.map((sheet) => sheet.acceptedSheetNumber ?? sheet.proposedSheetNumber);
  const comparison = compareIndex(index, numbers);
  return {
    sentence: indexSentence(index, comparison),
    missing: comparison.missing,
    unlisted: comparison.unlisted,
    onPage: index.pageNumber,
  };
}
