import type { ScheduleProposalView } from "@/components/ScheduleProposals";

import {
  countSheets,
  duplicateSheetNumbers,
  effectiveSheetNumber,
  effectiveTitle,
  sheetIndexSentence,
  type SheetRow,
} from "./plan-ingest/sheetIndex";
import { LIMITS } from "./takeoff-offer";

/**
 * WHAT WE MAIL BACK AFTER A FREE DRAWING-SET READ — the whole of it, as text.
 *
 * `/wall-takeoff` offers a prospective customer a free read of the set they
 * are bidding. The pipeline reads it; this file is the part a contractor
 * actually sees. It takes rows that are already loaded and returns a subject
 * line and a body. Nothing else.
 *
 * ── PLAIN TEXT, AND THAT IS A DECISION WITH A REASON ──
 *
 * `packages/integrations/src/email.ts` types the only body field this app
 * sends as "Plain text. Deliberately not HTML: a construction RFI is text,
 * and HTML mail is measurably more likely to be filtered." A first email
 * from an unknown sender to a contractor who has never heard of us is the
 * most filterable mail this product will ever send, and the one piece of mail
 * where landing in a spam folder costs us the entire relationship. So: no
 * HTML, no attachment, no tracking pixel, no images, and no link we would
 * have to mint and host. Columns are made of spaces.
 *
 * ── PURE ON PURPOSE ──
 *
 * No Prisma, no `@prova/db` value import, no `process.env`, no I/O. Every
 * fact in the mail arrives as an argument, which is what makes the whole
 * thing executable in the unit suite with real inputs — including the cases
 * that are hard to reach with a real PDF (a set that is all scans, a set
 * where a person corrected a sheet number, a 300-page set).
 *
 * ── WHAT COULD NOT BE READ COMES FIRST, AND THAT IS THE MOST IMPORTANT
 *    DECISION IN THIS FILE ──
 *
 * #672's whole subject was an app that knew why it could not read a sheet and
 * told nobody; two entire bid packages turned out to have no text layer at
 * all. A read that opens with forty rows it DID get and mentions the two
 * pages it missed at the bottom is a read that gets skimmed and trusted. So
 * the gaps are the first thing under the opening line, they name page
 * numbers, and they are never subject to the size ceiling below — the index
 * can be cut, the gaps cannot.
 *
 * ── NOTHING HERE IS A SECOND COPY ──
 *
 * The sheet-level vocabulary is `lib/plan-ingest/sheetIndex.ts`'s:
 * `effectiveSheetNumber`, `effectiveTitle`, `duplicateSheetNumbers`,
 * `countSheets`, `sheetIndexSentence`. The limits at the bottom are rendered
 * from `LIMITS` in `lib/takeoff-offer.ts`. CLAUDE.md's rule for a canonical
 * list is both guards — that the list is complete, and that it is the only
 * one — and it records a hand-rolled copy of a shared list quoting a bid
 * $1,732.50 under the screen that shared the same source. A promise restated
 * here as a literal would be the same defect against a contractor who agreed
 * to the page's version of it.
 *
 * The one place that bites: `components/ScheduleProposals.tsx` keeps a
 * private `KIND_LABEL` map and does not export it. Copying those six entries
 * here is exactly the shape above, so the schedule heading uses the table's
 * OWN title off the sheet where there is one, and otherwise derives a phrase
 * from the kind rather than looking it up. When that map becomes exported,
 * this should read it.
 */

/** Who the read is for, and which file it is about. */
export type ReadSubject = {
  companyName: string;
  contactName: string;
  projectName: string | null;
  /** The file as they sent it, so they can tell which set this is about. */
  fileName: string | null;
};

export type DeliveredRead = {
  subject: ReadSubject;
  sheets: SheetRow[];
  schedules: ScheduleProposalView[];
};

/**
 * THE MOST SHEET ROWS THE EMAIL LISTS, above which it says plainly how many
 * it left out.
 *
 * 120, and the reasoning is three separate things rather than a round number:
 *
 *  1. It is above the real distribution rather than inside it. A bid set a
 *     drywall or plaster sub is handed runs roughly 30-150 sheets, so 120
 *     delivers the overwhelming majority of real sets WHOLE and truncation
 *     stays the exception. A ceiling that fires on the normal case is a
 *     ceiling that trains people to ignore the notice.
 *  2. The limit is the reader, not the transport. 120 lines is two or three
 *     screens in a mail client — still something a contractor can run an eye
 *     down, which is the entire check the offer rests on. At 300 rows it is a
 *     wall of text nobody reads, and an unread index is worth nothing.
 *  3. It is nowhere near a transport limit, deliberately. 120 rows is about
 *     8 KB; Gmail clips a message around 102 KB and hides the rest behind
 *     "View entire message". That clipping is a SILENT truncation we do not
 *     control, and staying an order of magnitude below it is how we keep the
 *     only truncation in this mail the one that announces itself.
 *
 * Truncating without saying so is worse than a long email, so the cut always
 * prints a line naming the number left out. The gap and duplicate sections
 * above are NOT cut — they are the part of the read that cannot be
 * reconstructed from the drawing by looking.
 */
export const MAX_EMAILED_SHEETS = 120;

/** Two spaces between columns: enough to read as a column in a monospace
 *  client, and short enough that a proportional one still shows one record
 *  per line rather than a wrapped mess. */
const COLUMN_GAP = "  ";

/** What a cell says when the reader got nothing. Never blank, because a blank
 *  identity cell reads as a blank line in a table rather than as a gap, and
 *  never guessed. */
const NOT_READ = "not read";

/**
 * How wide the title column is allowed to PAD to.
 *
 * Nothing is truncated — a sheet title longer than this pushes its own row's
 * discipline to the right and stays whole. The ceiling only stops one
 * 200-character title from widening all 120 rows, which would be a different
 * way of making the index unreadable.
 */
const TITLE_PAD_CEILING = 44;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** "page 4", "pages 4 and 5", "pages 4, 5 and 9". */
function pagesPhrase(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  if (sorted.length === 1) return `page ${sorted[0]}`;
  const head = sorted.slice(0, -1).join(", ");
  return `pages ${head} and ${sorted[sorted.length - 1]}`;
}

function startOfSentence(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * Space-padded columns, with the padding trimmed off the end of every line.
 *
 * Trailing spaces matter in a plain-text mail: some clients render them,
 * some quote them back on reply, and none of them help.
 */
function renderColumns(
  header: string[],
  rows: string[][],
  options: { rightAlign?: number[]; padCeiling?: (number | undefined)[] } = {},
): string[] {
  const right = new Set(options.rightAlign ?? []);
  const widths = header.map((label, column) => {
    const longest = Math.max(label.length, ...rows.map((row) => (row[column] ?? "").length), 0);
    const ceiling = options.padCeiling?.[column];
    return ceiling === undefined ? longest : Math.min(longest, ceiling);
  });
  const line = (cells: string[]) =>
    header
      .map((_, column) => {
        const cell = cells[column] ?? "";
        const width = widths[column] ?? 0;
        return right.has(column) ? cell.padStart(width) : cell.padEnd(width);
      })
      .join(COLUMN_GAP)
      .replace(/\s+$/, "");
  return [line(header), ...rows.map(line)];
}

/**
 * The same comparison `duplicateSheetNumbers` makes, used only to find WHICH
 * PAGES carry a number it has already decided is duplicated.
 *
 * It is not a second copy of that function — the list of duplicated numbers
 * comes from the canonical one and this never decides what is a duplicate.
 * It is still a second place that knows "A-101" and "a-101 " are the same
 * sheet, so `takeoff-delivery.test.ts` pins the two together on a fixture
 * built out of exactly those variants: if this comparison ever drifts from
 * sheetIndex.ts's, the pages go missing and the build goes red.
 */
function sheetNumberKey(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function pagesForSheetNumber(sheets: SheetRow[], sheetNumber: string): number[] {
  const key = sheetNumberKey(sheetNumber);
  return sheets
    .filter((row) => {
      const number = effectiveSheetNumber(row);
      return number !== null && sheetNumberKey(number) === key;
    })
    .map((row) => row.pageNumber)
    .sort((a, b) => a - b);
}

/** What this set is called, in the order of how much it tells them. */
function setName(subject: ReadSubject): string {
  return clean(subject.fileName) || "the drawing set you sent";
}

/**
 * The subject line.
 *
 * NAMES THE PROJECT WHERE THERE IS ONE, because a sub bidding four jobs this
 * week has four of these in a thread list and the file name is often
 * `Bid Set.pdf` four times over. Where there is not one, the fragment is
 * absent rather than empty: a subject reading "— —" is how a cold email gets
 * deleted unread.
 */
export function deliverySubjectLine(read: DeliveredRead): string {
  const counts = countSheets(read.sheets);
  const what = clean(read.subject.projectName) || setName(read.subject);
  const tail =
    counts.pages === 0
      ? "nothing we could read"
      : `${counts.pages} ${counts.pages === 1 ? "sheet" : "sheets"}`;
  return `What we read off ${what} — ${tail}`;
}

/** Section 1: one line, naming the set, whose it is and the project. */
function openingLine(subject: ReadSubject): string {
  const firstName = clean(subject.contactName).split(/\s+/)[0] ?? "";
  const company = clean(subject.companyName);
  const project = clean(subject.projectName);

  const owner = company ? `, the set ${company} sent us` : "";
  const forProject = project ? ` for ${project}` : "";
  const sentence = `this is the free read of ${setName(subject)}${owner}${forProject}.`;
  return firstName ? `${firstName} — ${sentence}` : startOfSentence(sentence);
}

/** Section 2: the gaps, before anything we did read. */
function couldNotReadSection(sheets: SheetRow[]): string[] {
  if (sheets.length === 0) return [];

  const scans = sheets.filter((row) => !row.hasTextLayer);
  const noReading = sheets.filter((row) => row.hasTextLayer && !row.proposal);

  if (scans.length === 0 && noReading.length === 0) {
    // One line rather than an empty heading. A heading with nothing under it
    // reads as a section that failed to render.
    return ["We got a reading off every page of this set."];
  }

  const lines = ["SHEETS WE COULD NOT READ"];
  if (scans.length > 0) {
    const phrase = startOfSentence(pagesPhrase(scans.map((row) => row.pageNumber)));
    lines.push(
      scans.length === 1
        ? `${phrase} is a scan — there is no text on it at all, so nothing came off it. Somebody has to read the stamp.`
        : `${phrase} are scans — there is no text on them at all, so nothing came off them. Somebody has to read the stamps.`,
    );
  }
  if (noReading.length > 0) {
    const phrase = startOfSentence(pagesPhrase(noReading.map((row) => row.pageNumber)));
    lines.push(
      noReading.length === 1
        ? `${phrase} has text on it, but no title block came off it.`
        : `${phrase} have text on them, but no title block came off them.`,
    );
  }
  return lines;
}

/** Section 3: the same sheet number on more than one page. Absent when none. */
function duplicateSection(sheets: SheetRow[]): string[] {
  const duplicates = duplicateSheetNumbers(sheets);
  if (duplicates.length === 0) return [];
  return [
    "THE SAME SHEET NUMBER ON MORE THAN ONE PAGE",
    ...duplicates.map(
      (number) => `${number} — ${pagesPhrase(pagesForSheetNumber(sheets, number))}.`,
    ),
  ];
}

/** Section 4: every sheet, in page order, nothing dropped. */
function indexSection(sheets: SheetRow[]): string[] {
  if (sheets.length === 0) {
    // No heading: there is no table under it. The canonical sentence says the
    // whole of it on its own, and with no table beneath it there is nothing
    // for it to disagree with — which is the entire reason it is used HERE and
    // not above the table, per the note below.
    return [sheetIndexSentence(countSheets(sheets))];
  }

  // NO SUMMARY SENTENCE ABOVE THE TABLE, and this is a correction rather than
  // an omission. It used to carry `sheetIndexSentence(countSheets(sheets))`,
  // which is the canonical sentence and is not wrong — it is written for the
  // REVIEW SCREEN, where `countSheets` buckets a page whose title block was
  // read but yielded nothing under `awaiting`, while the table below renders
  // that same page as "not read". On a mixed set the two are both correct and
  // visibly disagree: a measured example read "2 need their numbers typed in"
  // above a table showing three unread rows.
  //
  // On a review screen that is a nuance. In the first thing a prospective
  // customer ever receives from us it is a free sample that cannot add up,
  // and the whole offer rests on a contractor being able to check it in ten
  // seconds. The table and the gap section above it already name every
  // unreadable page explicitly, so the sentence was adding no information it
  // could get wrong.
  //
  // The two alternatives were both worse: a second copy of that sentence here
  // is the drift CLAUDE.md records shipping a bid $1,732.50 under, and
  // re-bucketing inside `sheetIndex.ts` changes a review screen in another
  // lane to fix the wording of an email.

  // PAGE ORDER, not review order. `sortForReview` puts the least certain
  // first, which is right for somebody checking a screen and wrong for
  // somebody holding the set — a contractor runs an eye down an index in the
  // order the pages are bound.
  const ordered = [...sheets].sort((a, b) => a.pageNumber - b.pageNumber);
  const shown = ordered.slice(0, MAX_EMAILED_SHEETS);
  const leftOut = ordered.length - shown.length;

  const rows = shown.map((row) => [
    String(row.pageNumber),
    effectiveSheetNumber(row) ?? NOT_READ,
    effectiveTitle(row) ?? NOT_READ,
    clean(row.proposal?.discipline),
  ]);

  const lines = [
    "EVERY SHEET, AS WE READ IT",
    "",
    ...renderColumns(["Page", "Sheet", "Title", "Discipline"], rows, {
      rightAlign: [0],
      padCeiling: [undefined, undefined, TITLE_PAD_CEILING, undefined],
    }),
  ];

  if (leftOut > 0) {
    lines.push(
      "",
      `That is the first ${shown.length} sheets. ${leftOut} more ${
        leftOut === 1 ? "sheet is" : "sheets are"
      } not listed here, to keep this email readable — reply and we will send the rest.`,
    );
  }
  return lines;
}

/**
 * What to call one schedule.
 *
 * The table's own title off the sheet wins, because that is the string a
 * contractor can match against the drawing in front of them. Failing that the
 * phrase is DERIVED from the kind rather than looked up in a second copy of
 * `ScheduleProposals.tsx`'s private label map — so a kind added to
 * `SCHEDULE_KINDS` renders correctly here without an edit, which a copied map
 * could not do.
 */
function scheduleName(proposal: ScheduleProposalView): string {
  const title = clean(proposal.title);
  if (title) return title;
  const kind = clean(proposal.kind);
  // OTHER is the catch-all, and "Other schedule" is not a thing anybody calls
  // a table on a drawing.
  if (!kind || kind.toUpperCase() === "OTHER") return "Schedule";
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1).toLowerCase()} schedule`;
}

/** Where to go and look at it. The sheet number beats the page number for
 *  finding a drawing on a table, so both where we have both. */
function scheduleWhere(proposal: ScheduleProposalView): string {
  const sheetNumber = clean(proposal.sheetNumber);
  return sheetNumber
    ? `sheet ${sheetNumber}, page ${proposal.pageNumber}`
    : `page ${proposal.pageNumber}`;
}

/** Section 5: each schedule, as rows and columns. */
function schedulesSection(schedules: ScheduleProposalView[]): string[] {
  if (schedules.length === 0) return [];

  const lines = ["SCHEDULES WE READ"];
  for (const proposal of schedules) {
    lines.push("", `${scheduleName(proposal)} — ${scheduleWhere(proposal)}`);

    if (proposal.rows.length === 0) {
      lines.push("No rows came off this one.");
    } else {
      lines.push(
        ...renderColumns(
          ["Mark", "Description", "Size", "Qty", "Notes"],
          // AN EMPTY CELL IS EMPTY. There is no honest default for a door
          // size, and a dash in that column is a mark somebody could read as
          // being on the drawing.
          proposal.rows.map((row) => [
            row.mark,
            clean(row.description),
            clean(row.size),
            row.quantity === null ? "" : String(row.quantity),
            clean(row.notes),
          ]),
          { rightAlign: [3] },
        ),
      );
    }

    if (proposal.readRowCount < proposal.gridRowCount) {
      // The one number pair that tells somebody whether to trust the table —
      // the same arithmetic `ScheduleProposals` puts on screen, and the
      // reason it is on screen: a grid of 40 lines read as 12 rows either
      // dropped repeated headers or lost half the schedule, and only
      // somebody looking at the sheet can say which.
      lines.push(
        `We read ${proposal.readRowCount} of the ${proposal.gridRowCount} rows we could see in this table.`,
      );
    }
  }
  return lines;
}

/** Section 6: what we did not do, rendered from the offer's own list. */
function limitsSection(): string[] {
  return ["WHAT WE DID NOT DO", ...LIMITS.map((limit) => `- ${limit}`)];
}

/**
 * The whole body, in the order a contractor needs it: what is missing, then
 * what is suspect, then what we read, then what we never claimed to do.
 */
export function deliveryBody(read: DeliveredRead): string {
  const sections: string[][] = [
    [openingLine(read.subject)],
    couldNotReadSection(read.sheets),
    duplicateSection(read.sheets),
    indexSection(read.sheets),
    schedulesSection(read.schedules),
    limitsSection(),
  ];

  return sections
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");
}
