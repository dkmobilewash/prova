import type { ScheduleProposalView } from "@/components/ScheduleProposals";

import {
  countSheets,
  duplicateSheetNumbers,
  effectiveSheetNumber,
  effectiveTitle,
  sheetIndexSentence,
  type SheetRow,
  type SheetStatus,
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
 * ── TWO THINGS THE MAIL GOT WRONG, AND BOTH FIXES ARE ONE PLACE EACH ──
 *
 * Both were reproduced by running this renderer, and both are written up in
 * full at the code that fixes them rather than here. In short:
 *
 *  1. `asEmailed` — a reading a person REJECTED is no reading, for every
 *     section at once. `effectiveSheetNumber` does not look at status, so a
 *     rejected misread of `A-101` was mailed as fact, fabricated a
 *     duplicate-sheet warning against a set with no duplicate, and kept its
 *     page out of the gap list. Three sections disagreeing, because three
 *     sections each asked.
 *  2. `clean` — control characters out of every externally-sourced string.
 *     The subject fields come from an unauthenticated form and every sheet
 *     and schedule cell is model-extracted text off the prospect's own PDF; a
 *     newline in any of them writes a line of this email, and a forged
 *     "WHAT WE DID NOT DO" naming a bid price is what that buys.
 *
 * The shape they share is the reason they are worth reading together: each
 * was one question asked at several render sites, and each fix is that
 * question asked once, upstream, where the answer cannot differ by section.
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

/**
 * CONTROL CHARACTERS — the one thing in this file that is a security control
 * rather than a formatting choice.
 *
 * Every string this module renders that is not a literal in this repo came
 * from outside. The `ReadSubject` fields are typed into the UNAUTHENTICATED
 * form on `/wall-takeoff`; every sheet and schedule cell is text a model
 * pulled off the prospect's own PDF. A plain-text mail has exactly one
 * structure — a line is a line, a heading is a line in capitals — so a
 * newline inside one of those strings is not a cosmetic problem. It is the
 * ability to write a line of our email.
 *
 * MEASURED, NOT SUPPOSED. A schedule Notes cell reading
 * `"fine\n\nWHAT WE DID NOT DO\n- We priced this set at $412,000.\n- Walls
 * measured: 1,240 LF."` rendered a COMPLETE second "WHAT WE DID NOT DO"
 * section above the real one, naming a bid price and a wall quantity — the
 * exact two things `LIMITS` promises in writing we never send. A
 * `companyName` carrying the same shape planted a "SHEETS WE COULD NOT READ"
 * section inside the opening sentence, claiming forty pages were scans.
 *
 * AND IT NEEDS NO ATTACKER, which is why the strip belongs here and not at
 * the form. A Notes cell that physically WRAPS on the drawing — `"FIRE
 * RATED\n2 HR"` — breaks the table identically, and `renderColumns` measures
 * width with `.length` over the whole multi-line string, so one such cell
 * widens that column's padding for every row. The schedule vector does not
 * come through a form at all, so no input check on the form could reach it.
 *
 * COLLAPSED TO A SPACE, NEVER DELETED. `"FIRE RATED\n2 HR"` is two words on a
 * drawing and has to read `"FIRE RATED 2 HR"`; a deleting strip would print
 * `"FIRE RATED2 HR"`, which is a word on no sheet anywhere — this file does
 * not invent what it cannot read, and that includes inventing it by deletion.
 *
 * C0 and C1 both, and the `\s+` collapse after it catches `\u2028`/`\u2029`
 * too — they are line breaks to a mail client and whitespace to this regex.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * THE ONE DOOR every externally-sourced string comes through — trim, strip,
 * collapse. One helper rather than a check per site, because the sites are
 * where this was already wrong: `clean` only trimmed, and `row.mark` was not
 * passed through it at all.
 */
function clean(value: string | null | undefined): string {
  return (value ?? "")
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `clean`, for the fields where EMPTY must stay indistinguishable from
 * NOTHING READ.
 *
 * A cell that sanitises away to nothing is not a reading, so it reaches
 * `effectiveSheetNumber` as null and the row prints `NOT_READ` — rather than
 * a blank identity cell, which the constant above explains reads as a blank
 * line in a table instead of as a gap.
 */
function textOrNull(value: string | null | undefined): string | null {
  return clean(value) || null;
}

/**
 * HOW THIS EMAIL SEES ONE PAGE, and the only place that decides.
 *
 * ── A REJECTED READING IS NO READING ──
 *
 * `rejectPlanSheet` keeps the row on purpose, and
 * `components/PlanSheetReview.tsx` says why in words: *"Rejected — the reading
 * is kept, so the same set isn't proposed again as though nobody looked."* So
 * a rejected page is a NON-NULL proposal carrying a reading a person has
 * explicitly judged wrong, and `effectiveSheetNumber`/`effectiveTitle` answer
 * `acceptedSheetNumber ?? sheetNumber` with no regard for status. That is
 * right for the review screen, which shows the status in its own column, and
 * wrong for a mail that has no such column — so the fix is here and not in
 * `plan-ingest/sheetIndex.ts`.
 *
 * MEASURED: page 3 the real `A-101`, page 7's title block misread as `A-101 /
 * FIRST FLOOR PLAN` and REJECTED by a person. The mail printed "THE SAME SHEET
 * NUMBER ON MORE THAN ONE PAGE / A-101 — pages 3 and 7." — a duplicate-sheet
 * warning on a set with no duplicate in it, which is the one deliverable the
 * offer page calls unambiguous ("Two sheets stamped A-3 is how a scope hole
 * gets bid"). The same non-null proposal had the gap section claim "We got a
 * reading off every page of this set", and the index print the rejected number
 * twice as fact. Three sections wrong at once, from one question asked three
 * times in three places.
 *
 * So it is asked ONCE, here. The gap section, the duplicates, the counts and
 * the index all read the answer, and they cannot disagree because there is
 * nothing left for them to disagree about.
 */
type EmailedSheet = {
  /** The page as every section below reads it: a rejected reading removed,
   *  and every surviving string through `clean`. */
  row: SheetRow;
  /** True when the only reading this page ever had was one a person rejected.
   *  The row is a gap either way; this is what lets the gap section say which
   *  KIND of gap it is, rather than claiming no title block came off a page
   *  somebody demonstrably read. */
  readingRejected: boolean;
};

/**
 * Does a reading in this state belong in the mail?
 *
 * A SWITCH OVER THE WHOLE OF `SheetStatus`, each member decided out loud, and
 * the `never` in the default is the load-bearing part: a fourth status fails
 * TYPECHECK here instead of defaulting into "trust it", which is the direction
 * that mails a reading nobody has stood behind.
 */
function readingSurvivesReview(status: SheetStatus): boolean {
  switch (status) {
    // Nobody has looked yet, which is the normal state of a fresh read. It is
    // still the only reading we have, and nothing in this mail claims a person
    // checked it — the offer page's promise is a reading, not a verdict.
    case "PROPOSED":
      return true;
    // A person typed or confirmed this one. The strongest row in the mail, and
    // where their correction must beat the proposal rather than the reverse.
    case "ACCEPTED":
      return true;
    // A person read it against the sheet and said it is wrong. Sending it as
    // fact is the whole defect this type exists for.
    case "REJECTED":
      return false;
    default: {
      const unhandled: never = status;
      void unhandled;
      return false;
    }
  }
}

/** The map itself. Every section below takes its output; nothing below ever
 *  sees a raw `SheetRow` off the caller. */
function asEmailed(sheets: SheetRow[]): EmailedSheet[] {
  return sheets.map((row) => {
    const proposal = row.proposal;
    const readingRejected = proposal !== null && !readingSurvivesReview(proposal.status);
    if (proposal === null || readingRejected) {
      return {
        row: { pageNumber: row.pageNumber, hasTextLayer: row.hasTextLayer, proposal: null },
        readingRejected,
      };
    }
    return {
      row: {
        pageNumber: row.pageNumber,
        hasTextLayer: row.hasTextLayer,
        proposal: {
          ...proposal,
          sheetNumber: textOrNull(proposal.sheetNumber),
          title: textOrNull(proposal.title),
          discipline: textOrNull(proposal.discipline),
          acceptedSheetNumber: textOrNull(proposal.acceptedSheetNumber),
          acceptedTitle: textOrNull(proposal.acceptedTitle),
        },
      },
      readingRejected,
    };
  });
}

/** What the canonical `sheetIndex.ts` helpers take. They are still the only
 *  thing that decides a duplicate, a count or an effective value — they just
 *  decide it about the set as this email sees it. */
function rowsOf(sheets: EmailedSheet[]): SheetRow[] {
  return sheets.map((sheet) => sheet.row);
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
  // THROUGH THE MAP, like every other section: a rejected reading must not
  // change the count here either, and `clean` is what keeps a newline out of
  // a mail HEADER. Whether Resend sanitises a subject line is not something
  // this file gets to assume — a newline in a header is a header-injection
  // shape, and the cheap defence is the one on this side of the wire.
  const counts = countSheets(rowsOf(asEmailed(read.sheets)));
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
function couldNotReadSection(sheets: EmailedSheet[]): string[] {
  if (sheets.length === 0) return [];

  const scans = sheets.filter((sheet) => !sheet.row.hasTextLayer);
  // THREE BUCKETS, NOT TWO. A page whose only reading was rejected has a null
  // proposal by the time it gets here, so without this bucket it would be told
  // "no title block came off it" — which is false about a page a person read
  // and judged. A gap is a gap; lying about WHY is still a lie.
  const rejected = sheets.filter((sheet) => sheet.row.hasTextLayer && sheet.readingRejected);
  const noReading = sheets.filter(
    (sheet) => sheet.row.hasTextLayer && !sheet.readingRejected && !sheet.row.proposal,
  );

  if (scans.length === 0 && rejected.length === 0 && noReading.length === 0) {
    // One line rather than an empty heading. A heading with nothing under it
    // reads as a section that failed to render.
    return ["We got a reading off every page of this set."];
  }

  const lines = ["SHEETS WE COULD NOT READ"];
  if (scans.length > 0) {
    const phrase = startOfSentence(pagesPhrase(scans.map((sheet) => sheet.row.pageNumber)));
    lines.push(
      scans.length === 1
        ? `${phrase} is a scan — there is no text on it at all, so nothing came off it. Somebody has to read the stamp.`
        : `${phrase} are scans — there is no text on them at all, so nothing came off them. Somebody has to read the stamps.`,
    );
  }
  if (rejected.length > 0) {
    const phrase = startOfSentence(pagesPhrase(rejected.map((sheet) => sheet.row.pageNumber)));
    lines.push(
      rejected.length === 1
        ? `${phrase} gave us a reading we rejected on review, so we are not passing it on — that sheet number still needs typing in.`
        : `${phrase} gave us readings we rejected on review, so we are not passing them on — those sheet numbers still need typing in.`,
    );
  }
  if (noReading.length > 0) {
    const phrase = startOfSentence(pagesPhrase(noReading.map((sheet) => sheet.row.pageNumber)));
    lines.push(
      noReading.length === 1
        ? `${phrase} has text on it, but no title block came off it.`
        : `${phrase} have text on them, but no title block came off them.`,
    );
  }
  return lines;
}

/** Section 3: the same sheet number on more than one page. Absent when none. */
function duplicateSection(sheets: EmailedSheet[]): string[] {
  // `duplicateSheetNumbers` over the MAPPED rows, so a number only a rejected
  // reading ever claimed cannot make a duplicate out of a set that has none.
  const rows = rowsOf(sheets);
  const duplicates = duplicateSheetNumbers(rows);
  if (duplicates.length === 0) return [];
  return [
    "THE SAME SHEET NUMBER ON MORE THAN ONE PAGE",
    ...duplicates.map(
      (number) => `${clean(number)} — ${pagesPhrase(pagesForSheetNumber(rows, number))}.`,
    ),
  ];
}

/** Section 4: every sheet, in page order, nothing dropped. */
function indexSection(sheets: EmailedSheet[]): string[] {
  if (sheets.length === 0) {
    // No heading: there is no table under it. The canonical sentence says the
    // whole of it on its own, and with no table beneath it there is nothing
    // for it to disagree with — which is the entire reason it is used HERE and
    // not above the table, per the note below.
    return [sheetIndexSentence(countSheets(rowsOf(sheets)))];
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
  const ordered = rowsOf(sheets).sort((a, b) => a.pageNumber - b.pageNumber);
  const shown = ordered.slice(0, MAX_EMAILED_SHEETS);
  const leftOut = ordered.length - shown.length;

  // `clean` again at the cell, not because the map left anything behind — it
  // did not — but because this is a RENDER SITE, and the rule in this file is
  // that no externally-sourced string reaches a line of the mail without
  // passing the one door. `|| NOT_READ` rather than `?? NOT_READ`: a value
  // that sanitises away to nothing is not a sheet number.
  const rows = shown.map((row) => [
    String(row.pageNumber),
    clean(effectiveSheetNumber(row)) || NOT_READ,
    clean(effectiveTitle(row)) || NOT_READ,
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
            // `clean` HERE IS THE FIX, not decoration: `row.mark` was the one
            // schedule cell that never went through it.
            clean(row.mark),
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
  // ONE MAP, FOUR SECTIONS. The gap section, the duplicates, the counts and
  // the index are all answers about the same set, and they used to each ask
  // the rows directly — which is how a rejected reading became a gap that was
  // not reported, a duplicate that did not exist, and an index row stating a
  // number a person had struck out, all in the same mail.
  const sheets = asEmailed(read.sheets);
  const sections: string[][] = [
    [openingLine(read.subject)],
    couldNotReadSection(sheets),
    duplicateSection(sheets),
    indexSection(sheets),
    schedulesSection(read.schedules),
    limitsSection(),
  ];

  return sections
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");
}
