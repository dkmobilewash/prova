/**
 * THE SHEET INDEX — computed at read time, never stored, never a job.
 *
 * `PlanIngestStage.SHEET_INDEX` exists in the enum and stays `null` in
 * `STAGE_WORK`, which looks like an omission and is a decision. Ordering sheets,
 * spotting a duplicate number and counting what still needs a person is pure
 * computation over rows that are already there: microseconds, no model call, no
 * database. As a STAGE it would be worse in three separate ways — the runner
 * creates one task per page, so it would either run three hundred times over the
 * same set or need a one-task job for a three-hundred-page plan, which would make
 * `PlanIngestJob.pageCount` disagree with `count(tasks)` by design when that
 * comparison is the only thing that catches a lost row. And a stored order is what
 * `DocumentIntake` refuses outright: "review order is computed at read time and
 * must never become a stored rank."
 *
 * So this file is `lib/intake/review.ts` for plan sheets, and deliberately the
 * same shape: pure functions, no imports from prisma, unit-tested in a
 * millisecond. The unit suite runs in `environment: "node"`, so logic that lives
 * here is testable and logic that lives in the component is not.
 */

export type SheetConfidence = "HIGH" | "MEDIUM" | "LOW";
export type SheetStatus = "PROPOSED" | "ACCEPTED" | "REJECTED";

/** One page of the set, as the review screen sees it: what was read off it, what
 *  was proposed about it, and what a person has said. */
export type SheetRow = {
  pageNumber: number;
  /** False when the sheet is a scan. There is then no proposal and never will be
   *  one until somebody types the number in. */
  hasTextLayer: boolean;
  /** Null when `TITLE_BLOCK` has not reached this page yet, or never will because
   *  there is no text to read. */
  proposal: {
    id: string;
    sheetNumber: string | null;
    title: string | null;
    discipline: string | null;
    /** One of `SHEET_PAGE_TYPES`, normalised, so the index can be filtered
     *  to the schedule sheets. Null when nothing could be read, or when the
     *  proposal predates prompt `plan-title-block.2`. */
    pageType: string | null;
    scale: string | null;
    revision: string | null;
    issueDate: string | null;
    reason: string;
    confidence: SheetConfidence;
    status: SheetStatus;
    acceptedSheetNumber: string | null;
    acceptedTitle: string | null;
  } | null;
};

/**
 * What a row's sheet number IS, for display and for duplicate detection: what a
 * person accepted if they have, else what was proposed.
 *
 * ACCEPTED WINS, and that is the only place in this file where the two columns are
 * collapsed. They are kept apart in the schema precisely so "how often did a
 * person change the answer" stays answerable; a reader of the screen wants the
 * settled value, and a reader of the data wants both.
 */
export function effectiveSheetNumber(row: SheetRow): string | null {
  if (!row.proposal) return null;
  return row.proposal.acceptedSheetNumber ?? row.proposal.sheetNumber;
}

export function effectiveTitle(row: SheetRow): string | null {
  if (!row.proposal) return null;
  return row.proposal.acceptedTitle ?? row.proposal.title;
}

/**
 * Where a row sorts. LOWER RANKS FIRST.
 *
 * LOW CONFIDENCE TO THE TOP, which is `DocumentIntakeConfidence`'s choice and its
 * reasoning: "HIGH sorts to the BOTTOM of the review screen, which is what makes
 * over-claiming it the expensive mistake." A model that says HIGH and is wrong has
 * buried its own error at the end of a three-hundred-row list; one that says LOW
 * has put it where somebody will look.
 *
 * Above even that: a page with NO PROPOSAL AT ALL. A scanned sheet cannot be read
 * and needs its number typed, which is the only work on this screen that a person
 * must do rather than merely check.
 */
export function reviewRank(row: SheetRow): number {
  if (!row.proposal) return 0;
  if (row.proposal.status === "ACCEPTED") return 5;
  if (row.proposal.status === "REJECTED") return 6;
  if (row.proposal.confidence === "LOW") return 1;
  if (row.proposal.confidence === "MEDIUM") return 2;
  return 3;
}

/**
 * The review order.
 *
 * COPIES BEFORE SORTING and tie-breaks on page number, so the order is TOTAL —
 * `review.ts` does the same with a filename and for the same reason: a row that
 * can move under the cursor between renders is a row somebody accepts by accident.
 */
export function sortForReview(rows: SheetRow[]): SheetRow[] {
  return [...rows].sort((a, b) => reviewRank(a) - reviewRank(b) || a.pageNumber - b.pageNumber);
}

/**
 * Sheet numbers that more than one page claims.
 *
 * WORTH FLAGGING because it is unambiguous and it is usually real: two pages both
 * reading "A-101" means one of them was misread, or the upload is two volumes
 * concatenated. Either way somebody has to look, and an index with the same sheet
 * number twice is one nobody can navigate by.
 *
 * Compared case-insensitively and with whitespace collapsed, because "A-101" and
 * "A‑101 " are the same sheet to everyone except a string comparison.
 */
export function duplicateSheetNumbers(rows: SheetRow[]): string[] {
  const seen = new Map<string, string[]>();
  for (const row of rows) {
    const number = effectiveSheetNumber(row);
    if (!number) continue;
    const key = number.trim().toUpperCase().replace(/\s+/g, " ");
    seen.set(key, [...(seen.get(key) ?? []), number]);
  }
  return [...seen.entries()]
    .filter(([, all]) => all.length > 1)
    .map(([, all]) => all[0]!)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * GAPS ARE DELIBERATELY NOT FLAGGED, and this comment is the decision rather than
 * an absence.
 *
 * The plan for this feature said "flags duplicate sheet numbers and gaps", and a
 * gap detector is the obvious other half. It is not built because on real sheet
 * numbering it would be WRONG far more often than right: A-101 followed by A-201
 * is not a missing hundred sheets, it is the elevations series starting. Sets skip
 * numbers for cancelled sheets, number by floor, restart per discipline, and use
 * A2.1 as readily as A-201. Every one of those reads as a gap to an arithmetic
 * check.
 *
 * A caution that is usually wrong is worse than no caution — it is the defect this
 * repo just paid for twice on the quote reader, where a panel that spoke on every
 * document was on its way to being a panel nobody read. So: duplicates, which are
 * unambiguous, and pages with nothing read, which are actionable. If gap detection
 * ever earns its place it needs a rule about SERIES rather than about integers,
 * and that is its own piece of work with its own evidence.
 */

export type SheetIndexCounts = {
  pages: number;
  /** Proposed and not yet accepted or rejected. */
  awaiting: number;
  accepted: number;
  rejected: number;
  /** Scans, and pages `TITLE_BLOCK` has not reached. Need a person, not a check. */
  noReading: number;
  lowConfidence: number;
};

export function countSheets(rows: SheetRow[]): SheetIndexCounts {
  const counts: SheetIndexCounts = {
    pages: rows.length,
    awaiting: 0,
    accepted: 0,
    rejected: 0,
    noReading: 0,
    lowConfidence: 0,
  };
  for (const row of rows) {
    if (!row.proposal) {
      counts.noReading += 1;
      continue;
    }
    if (row.proposal.status === "ACCEPTED") counts.accepted += 1;
    else if (row.proposal.status === "REJECTED") counts.rejected += 1;
    else counts.awaiting += 1;
    if (row.proposal.status === "PROPOSED" && row.proposal.confidence === "LOW") counts.lowConfidence += 1;
  }
  return counts;
}

/**
 * One sentence for the top of the screen.
 *
 * SAYS "READ", NEVER "IDENTIFIED" OR "INDEXED", which is `review.ts`'s rule —
 * its own summary says "ready to file" and never "filed automatically", because a
 * sentence that overstates what happened is the one a person quotes back when the
 * numbers turn out wrong. Nothing on this screen has been accepted by a machine.
 */
export function sheetIndexSentence(counts: SheetIndexCounts): string {
  if (counts.pages === 0) return "Nothing has been read from this plan set yet.";

  const parts: string[] = [];
  if (counts.awaiting > 0) parts.push(`${counts.awaiting} to check`);
  if (counts.noReading > 0) {
    // The POSSESSIVE agrees too, not just the verb. This read "5 need its number
    // typed in" — the verb was pluralised and "its" was not — and a browser
    // tester reported it before any test did, because no test asserted the
    // sentence for a count above one.
    parts.push(
      counts.noReading === 1
        ? "1 needs its number typed in"
        : `${counts.noReading} need their numbers typed in`,
    );
  }
  if (counts.accepted > 0) parts.push(`${counts.accepted} confirmed`);
  if (counts.rejected > 0) parts.push(`${counts.rejected} rejected`);

  const of = `${counts.pages} ${counts.pages === 1 ? "sheet" : "sheets"}`;
  if (parts.length === 0) return `${of}, and nothing to do.`;
  const tail =
    counts.lowConfidence > 0
      ? ` The ${counts.lowConfidence} the reader was least sure about ${counts.lowConfidence === 1 ? "is" : "are"} first.`
      : "";
  return `${of}: ${parts.join(", ")}.${tail}`;
}
