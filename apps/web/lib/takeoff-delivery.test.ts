import { describe, expect, it } from "vitest";

import type { ScheduleProposalView } from "@/components/ScheduleProposals";

import {
  countSheets,
  duplicateSheetNumbers,
  sheetIndexSentence,
  type SheetRow,
  type SheetStatus,
} from "./plan-ingest/sheetIndex";
import { LIMITS } from "./takeoff-offer";
import {
  MAX_EMAILED_SHEETS,
  deliveryBody,
  deliverySubjectLine,
  type DeliveredRead,
  type ReadSubject,
} from "./takeoff-delivery";

/**
 * THE MAIL IS THE PRODUCT HERE, SO IT IS TESTED BY READING IT.
 *
 * Every assertion below executes the real functions against hand-built rows
 * and then reads the string that comes out. Nothing asserts a shape.
 *
 * The one that matters most is the last block: NOTHING IN THE OUTPUT IS A
 * NUMBER THE INPUT DID NOT CONTAIN. A free read is only worth sending if a
 * contractor can check it against the set on the table, and a page number we
 * invented is worse than a gap — it sends somebody to a page that has nothing
 * to do with what we said about it, and it is the one error that destroys the
 * credibility of every true row above it.
 *
 * Two places carry a SIZE assertion over something this file DERIVES from the
 * body, for the reason `scratch-cleanup-order.test.ts` learned the hard way:
 * a parser that matches nothing passes every downstream assertion, because
 * nothing is ever missing from an empty set. So the page-number sweep and the
 * empty-heading sweep both assert they found something first.
 */

// ── fixtures ───────────────────────────────────────────────────────────────

function sheet(
  pageNumber: number,
  options: {
    hasTextLayer?: boolean;
    noProposal?: boolean;
    sheetNumber?: string | null;
    title?: string | null;
    discipline?: string | null;
    status?: SheetStatus;
    acceptedSheetNumber?: string | null;
    acceptedTitle?: string | null;
  } = {},
): SheetRow {
  const hasTextLayer = options.hasTextLayer ?? true;
  // A scan never has a proposal and never will until somebody types the
  // number in — sheetIndex.ts's own words for why `proposal` is null there.
  const noProposal = options.noProposal ?? !hasTextLayer;
  return {
    pageNumber,
    hasTextLayer,
    proposal: noProposal
      ? null
      : {
          id: `prop-${pageNumber}`,
          sheetNumber: options.sheetNumber ?? null,
          title: options.title ?? null,
          discipline: options.discipline ?? null,
          pageType: null,
          scale: null,
          revision: null,
          issueDate: null,
          reason: "read off the title block",
          confidence: "HIGH",
          status: options.status ?? "PROPOSED",
          acceptedSheetNumber: options.acceptedSheetNumber ?? null,
          acceptedTitle: options.acceptedTitle ?? null,
        },
  };
}

const SUBJECT: ReadSubject = {
  companyName: "Alvarado Drywall",
  contactName: "Rafael Alvarado",
  projectName: "Sunrise Medical Office Building",
  fileName: "Sunrise-bid-set.pdf",
};

/**
 * One set covering every case at once, because that is how a real set
 * arrives: a few clean pages, a scan, a page the reader did not get to, a
 * repeated number, and one a person corrected.
 *
 * NO STANDALONE DIGITS IN ANY TITLE OR DISCIPLINE, deliberately — the
 * number sweep at the bottom would otherwise have to allow them and could
 * not then tell an invented page number from a title that mentions a floor.
 */
const richSet: SheetRow[] = [
  sheet(1, { sheetNumber: "G-001", title: "Cover Sheet", discipline: "General" }),
  sheet(2, { sheetNumber: "A-101", title: "Floor Plan", discipline: "Architectural" }),
  // A scan: no text layer, so no proposal and nothing to report but the page.
  sheet(3, { hasTextLayer: false }),
  // Text on the page, but TITLE_BLOCK has not reached it.
  sheet(4, { noProposal: true }),
  // The same sheet number as page 2, written the way a different title block
  // prints it. `duplicateSheetNumbers` compares case-insensitively with
  // whitespace collapsed, and so must the pages this email names.
  sheet(5, { sheetNumber: "a-101 ", title: "Floor Plan", discipline: "Architectural" }),
  // A person ACCEPTED a different number and title than were proposed.
  sheet(6, {
    sheetNumber: "A-206",
    title: "Enlarged Plan",
    discipline: "Architectural",
    status: "ACCEPTED",
    acceptedSheetNumber: "A-205",
    acceptedTitle: "Enlarged Plans",
  }),
  // A proposal that read nothing usable. Not a scan, so not in the gap
  // section — the ROW has to say so instead.
  sheet(7, { sheetNumber: null, title: null, discipline: null }),
  sheet(8, { sheetNumber: "A-601", title: "Partition Types", discipline: "Architectural" }),
];

const partitionSchedule: ScheduleProposalView = {
  id: "sched-partition",
  pageNumber: 8,
  sheetNumber: "A-601",
  kind: "PARTITION",
  title: "PARTITION SCHEDULE",
  rows: [
    {
      mark: "P1",
      description: "One-hour rated partition",
      size: "five eighths gypsum, both faces",
      quantity: null,
      notes: "deck to deck",
    },
    { mark: "P2", description: "Shaft wall", size: null, quantity: null, notes: null },
  ],
  reason: "grid read off the sheet",
  confidence: "HIGH",
  gridRowCount: 2,
  readRowCount: 2,
};

/** No title of its own, no accepted sheet number, and a grid we only partly
 *  read — the three things that make a schedule awkward to render. */
const doorSchedule: ScheduleProposalView = {
  id: "sched-door",
  pageNumber: 2,
  sheetNumber: null,
  kind: "DOOR",
  title: null,
  rows: [{ mark: "D1", description: null, size: null, quantity: null, notes: null }],
  reason: "grid partly obscured",
  confidence: "LOW",
  gridRowCount: 4,
  readRowCount: 1,
};

const richRead: DeliveredRead = {
  subject: SUBJECT,
  sheets: richSet,
  schedules: [partitionSchedule, doorSchedule],
};

/** Every page read, every number distinct: the set that must print neither a
 *  gap section nor a duplicate section. */
function cleanSet(count: number): SheetRow[] {
  return Array.from({ length: count }, (_, index) =>
    sheet(index + 1, {
      sheetNumber: `A-${100 + index}`,
      title: "Floor Plan",
      discipline: "Architectural",
    }),
  );
}

function readOf(sheets: SheetRow[], schedules: ScheduleProposalView[] = []): DeliveredRead {
  return { subject: SUBJECT, sheets, schedules };
}

// ── helpers that read the body back ────────────────────────────────────────

/** A heading is an all-caps line. Nothing else this file emits is one: a
 *  schedule's own line carries lowercase words, an index row starts with
 *  digits, and a limit starts with a dash. */
const HEADING = /^[A-Z][A-Z ,]+$/;

function headings(body: string): string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => HEADING.test(line));
}

/** The index table's rows: a page number, then the column gap. */
function indexRows(body: string): string[] {
  return body.split("\n").filter((line) => /^\s*\d+\s{2,}/.test(line));
}

function indexRowFor(body: string, pageNumber: number): string | undefined {
  return indexRows(body).find((line) => line.trim().startsWith(`${pageNumber} `));
}

/** Integers that stand alone — not part of `A-101`, not part of `20ga`. */
const STANDALONE_NUMBER = /(?<![\w-])\d+(?![\w-])/g;

function numbersIn(text: string): number[] {
  return [...text.matchAll(STANDALONE_NUMBER)].map((match) => Number(match[0]));
}

/** Every page number the body actually CLAIMS: the ones following the word
 *  "page"/"pages", and the page column of the index. */
function pageNumbersClaimed(body: string): number[] {
  const out: number[] = [];
  for (const match of body.matchAll(/\bpages?\s+((?:\d+)(?:(?:,|\s+and)\s+\d+)*)/gi)) {
    out.push(...numbersIn(match[1] ?? ""));
  }
  for (const row of indexRows(body)) {
    const first = row.trim().match(/^(\d+)/);
    if (first) out.push(Number(first[1]));
  }
  return out;
}

// ── the gaps come first ────────────────────────────────────────────────────

describe("takeoff delivery — what we could not read comes before what we did", () => {
  it("puts the gap section ahead of the index, by position in the string", () => {
    const body = deliveryBody(richRead);
    const gaps = body.indexOf("SHEETS WE COULD NOT READ");
    const index = body.indexOf("EVERY SHEET, AS WE READ IT");
    expect(gaps, "the gap section is missing").toBeGreaterThan(-1);
    expect(index, "the sheet index is missing").toBeGreaterThan(-1);
    // ORDER IS THE POINT, not presence. A read that opens with forty rows it
    // got and mentions the two pages it missed at the bottom gets skimmed.
    expect(gaps).toBeLessThan(index);
  });

  it("names the scanned pages and the unread pages separately", () => {
    const body = deliveryBody(richRead);
    const gaps = body.slice(
      body.indexOf("SHEETS WE COULD NOT READ"),
      body.indexOf("THE SAME SHEET NUMBER"),
    );
    expect(gaps).toMatch(/page 3 is a scan/i);
    expect(gaps).toMatch(/page 4 has text on it/i);
  });

  it("says so in one line, with no heading, when every page read", () => {
    const body = deliveryBody(readOf(cleanSet(4)));
    expect(body).not.toContain("SHEETS WE COULD NOT READ");
    expect(body).toMatch(/reading off every page/);
  });

  it("pluralises the gap sentences rather than printing a count at somebody", () => {
    const body = deliveryBody(
      readOf([
        sheet(1, { hasTextLayer: false }),
        sheet(2, { hasTextLayer: false }),
        sheet(3, { noProposal: true }),
        sheet(4, { noProposal: true }),
      ]),
    );
    expect(body).toMatch(/Pages 1 and 2 are scans/);
    expect(body).toMatch(/Pages 3 and 4 have text on them/);
  });
});

// ── nothing is dropped ─────────────────────────────────────────────────────

describe("takeoff delivery — a page we could not read is still in the index", () => {
  it("gives the scanned page a row that says what is missing", () => {
    const body = deliveryBody(richRead);
    const row = indexRowFor(body, 3);
    expect(row, "page 3 has no row in the index at all").toBeDefined();
    // Never dropped, never guessed.
    expect(row).toContain("not read");
  });

  it("gives a row to a page whose proposal read nothing usable", () => {
    const body = deliveryBody(richRead);
    const row = indexRowFor(body, 7);
    expect(row).toBeDefined();
    expect(row).toContain("not read");
  });

  it("has a row for every page of the set", () => {
    const body = deliveryBody(richRead);
    for (const row of richSet) {
      expect(indexRowFor(body, row.pageNumber), `page ${row.pageNumber}`).toBeDefined();
    }
    // `indexRows` matches data rows only — the column header starts with a word.
    expect(indexRows(body)).toHaveLength(richSet.length);
  });

  it("prints the number and title a person ACCEPTED, not the one proposed", () => {
    const body = deliveryBody(richRead);
    const row = indexRowFor(body, 6);
    expect(row).toContain("A-205");
    expect(row).toContain("Enlarged Plans");
    expect(row).not.toContain("A-206");
    expect(body).not.toContain("Enlarged Plan ");
  });
});

// ── no empty sections ──────────────────────────────────────────────────────

describe("takeoff delivery — no heading is printed with nothing under it", () => {
  const bodies: [string, string][] = [
    ["a set with every case in it", deliveryBody(richRead)],
    ["a set that read cleanly", deliveryBody(readOf(cleanSet(3)))],
    ["an empty set", deliveryBody(readOf([]))],
    ["a set with no schedules", deliveryBody(readOf(richSet))],
  ];

  it("found headings to check, in the body that has the most of them", () => {
    // The size assertion. A heading pattern that matched nothing would make
    // every assertion below pass on an empty list.
    expect(headings(deliveryBody(richRead)).length).toBeGreaterThanOrEqual(4);
  });

  for (const [name, body] of bodies) {
    it(`gives every heading content — ${name}`, () => {
      const lines = body.split("\n").map((line) => line.trim());
      for (const [position, line] of lines.entries()) {
        if (!HEADING.test(line)) continue;
        const next = lines.slice(position + 1).find((candidate) => candidate !== "");
        expect(next, `"${line}" is the last thing in the body`).toBeDefined();
        expect(
          next && HEADING.test(next),
          `"${line}" is followed straight away by "${next}" — a heading with nothing under it`,
        ).toBe(false);
      }
    });
  }

  it("prints no summary sentence above the table that could disagree with it", () => {
    // PINS A DECISION, because the thing removed was not a bug and will look
    // like an omission to whoever reads this next. `sheetIndexSentence` is the
    // canonical sentence and it is written for the review screen, where
    // `countSheets` files a page whose title block read nothing under
    // `awaiting` while this table renders it "not read". Both correct, and on
    // a mixed set they visibly disagree — measured at "2 need their numbers
    // typed in" above three unread rows.
    //
    // A free sample that cannot add up is worse than one that says less, so
    // the table stands on its own and the gap section above it names every
    // unreadable page. Re-adding the sentence here reds this test.
    // The three buckets that make the canonical sentence and the table
    // disagree: one clean read, one scan, and one page whose title block was
    // read and yielded nothing.
    const mixed = [
      sheet(1, { sheetNumber: "G-001", title: "Cover Sheet", discipline: "General" }),
      sheet(2, { hasTextLayer: false }),
      sheet(3, { sheetNumber: null, title: null, discipline: null }),
    ];
    const body = deliveryBody(readOf(mixed));
    const heading = body.indexOf("EVERY SHEET, AS WE READ IT");
    const firstRow = body.indexOf("Page", heading);
    expect(heading).toBeGreaterThan(-1);
    expect(firstRow).toBeGreaterThan(heading);
    // Nothing but blank lines between the heading and the column header.
    const between = body.slice(heading + "EVERY SHEET, AS WE READ IT".length, firstRow);
    expect(between.trim()).toBe("");
    expect(body).not.toContain(sheetIndexSentence(countSheets(mixed)));
  });

  it("says the one canonical sentence and no table for an empty set", () => {
    const body = deliveryBody(readOf([]));
    expect(body).toContain(sheetIndexSentence(countSheets([])));
    expect(body).not.toContain("EVERY SHEET, AS WE READ IT");
    expect(indexRows(body)).toEqual([]);
  });

  it("renders no empty cell as the word null or undefined", () => {
    const body = deliveryBody({
      subject: { companyName: "", contactName: "", projectName: null, fileName: null },
      sheets: [sheet(1, { sheetNumber: null, title: null, discipline: null })],
      schedules: [doorSchedule],
    });
    expect(body).not.toMatch(/\b(null|undefined|NaN)\b/);
  });
});

// ── duplicates ─────────────────────────────────────────────────────────────

describe("takeoff delivery — the same sheet number on more than one page", () => {
  it("names the number and both pages it is on", () => {
    const body = deliveryBody(richRead);
    const duplicates = duplicateSheetNumbers(richSet);
    expect(duplicates).toEqual(["A-101"]);
    // PINS THIS FILE'S COMPARISON TO sheetIndex.ts's. Pages 2 and 5 read
    // "A-101" and "a-101 " — if the normalisation here ever drifts from the
    // canonical one, the duplicate is still named and one of its pages goes
    // missing, which this would catch.
    expect(body).toContain(`${duplicates[0]} — pages 2 and 5.`);
  });

  it("omits the section entirely when there are no duplicates", () => {
    const clean = cleanSet(5);
    expect(duplicateSheetNumbers(clean)).toEqual([]);
    const body = deliveryBody(readOf(clean));
    expect(body).not.toContain("THE SAME SHEET NUMBER");
    // The positive control: the pattern above does appear when it should, so
    // this is a real absence rather than a string nobody emits.
    expect(deliveryBody(richRead)).toContain("THE SAME SHEET NUMBER");
  });
});

// ── the size ceiling ───────────────────────────────────────────────────────

describe("takeoff delivery — a long set is cut, and the cut says so", () => {
  it("lists everything at the ceiling and says nothing about truncation", () => {
    const body = deliveryBody(readOf(cleanSet(MAX_EMAILED_SHEETS)));
    expect(indexRows(body)).toHaveLength(MAX_EMAILED_SHEETS);
    expect(body).not.toMatch(/not listed here/);
  });

  it("says how many were left out, and the number is right", () => {
    const over = 7;
    const body = deliveryBody(readOf(cleanSet(MAX_EMAILED_SHEETS + over)));
    expect(indexRows(body)).toHaveLength(MAX_EMAILED_SHEETS);

    const sentence = body.match(
      /That is the first (\d+) sheets\. (\d+) more sheets are not listed here/,
    );
    expect(sentence, "the cut printed no notice at all").not.toBeNull();
    expect(Number(sentence?.[1])).toBe(MAX_EMAILED_SHEETS);
    // The count has to be RIGHT, not merely present: a wrong one is worse
    // than none, because it is checkable and wrong.
    expect(Number(sentence?.[2])).toBe(over);
    expect(body).toMatch(/send the rest/);
  });

  it("never cuts the gap section, which is why it comes first", () => {
    const sheets = [...cleanSet(MAX_EMAILED_SHEETS + 20), sheet(999, { hasTextLayer: false })];
    const body = deliveryBody(readOf(sheets));
    expect(body).toMatch(/Page 999 is a scan/);
  });

  it("sets the ceiling somewhere a real bid set usually fits inside", () => {
    expect(MAX_EMAILED_SHEETS).toBeGreaterThanOrEqual(100);
    expect(MAX_EMAILED_SHEETS).toBeLessThanOrEqual(200);
  });
});

// ── the subject line ───────────────────────────────────────────────────────

describe("takeoff delivery — the subject line", () => {
  it("names the project when there is one", () => {
    const line = deliverySubjectLine(richRead);
    expect(line).toContain("Sunrise Medical Office Building");
    expect(line).toContain("8 sheets");
  });

  it("names the file when there is no project", () => {
    const line = deliverySubjectLine({
      ...richRead,
      subject: { ...SUBJECT, projectName: null },
    });
    expect(line).toContain("Sunrise-bid-set.pdf");
    expect(line).not.toContain("Sunrise Medical Office Building");
  });

  it("renders no empty fragment when there is neither", () => {
    const line = deliverySubjectLine({
      ...richRead,
      subject: { ...SUBJECT, projectName: null, fileName: null },
    });
    expect(line).not.toMatch(/—\s*—|—\s*$|\s{2,}|\(\s*\)/);
    expect(line).not.toMatch(/\b(null|undefined)\b/);
    expect(line).toMatch(/the drawing set you sent/);
  });

  it("counts one sheet as a sheet", () => {
    expect(deliverySubjectLine(readOf(cleanSet(1)))).toContain("1 sheet");
    expect(deliverySubjectLine(readOf(cleanSet(1)))).not.toContain("1 sheets");
  });

  it("does not claim a count for a set nothing came off", () => {
    expect(deliverySubjectLine(readOf([]))).toContain("nothing");
  });
});

// ── the opening line and the schedules ─────────────────────────────────────

describe("takeoff delivery — the opening line and the schedules", () => {
  it("opens with one line naming the set, the company and the project", () => {
    const first = deliveryBody(richRead).split("\n")[0] ?? "";
    expect(first).toContain("Rafael");
    expect(first).toContain("Sunrise-bid-set.pdf");
    expect(first).toContain("Alvarado Drywall");
    expect(first).toContain("Sunrise Medical Office Building");
  });

  it("starts the sentence properly when there is no name to use", () => {
    const first =
      deliveryBody({ ...richRead, subject: { ...SUBJECT, contactName: "  " } }).split("\n")[0] ?? "";
    expect(first).not.toMatch(/^\s*—/);
    expect(first).toMatch(/^This is/);
  });

  it("names each schedule by the title on the sheet and where to find it", () => {
    const body = deliveryBody(richRead);
    expect(body).toContain("PARTITION SCHEDULE — sheet A-601, page 8");
    expect(body).toContain("P1");
    expect(body).toContain("One-hour rated partition");
  });

  it("derives a name for a schedule with no title of its own", () => {
    const body = deliveryBody(richRead);
    // Not a second copy of ScheduleProposals.tsx's private label map: the
    // phrase is derived from the kind, so a new kind needs no edit here.
    expect(body).toContain("Door schedule — page 2");
  });

  it("reports the rows it did not get off a partly-read grid", () => {
    const body = deliveryBody(richRead);
    expect(body).toContain("We read 1 of the 4 rows we could see in this table.");
    // Nothing to report when the whole grid came off.
    expect(body).not.toContain("We read 2 of the 2 rows");
  });

  it("leaves an empty cell empty rather than filling it in", () => {
    const body = deliveryBody(readOf([], [doorSchedule]));
    const row = body.split("\n").find((line) => line.startsWith("D1"));
    expect(row).toBeDefined();
    expect(row?.trim()).toBe("D1");
  });

  it("omits the schedule section when there are none", () => {
    expect(deliveryBody(readOf(richSet))).not.toContain("SCHEDULES WE READ");
  });

  it("says so rather than printing an empty table for a schedule with no rows", () => {
    const body = deliveryBody(readOf([], [{ ...doorSchedule, rows: [], readRowCount: 0 }]));
    expect(body).toContain("No rows came off this one.");
  });
});

// ── the limits come from the offer ─────────────────────────────────────────

describe("takeoff delivery — the closing limits are the offer's own", () => {
  it("renders every limit from LIMITS rather than restating one", () => {
    const body = deliveryBody(richRead);
    // Asserted against the imported array. A retyped copy here would also be
    // caught by takeoff-offer.test.ts's second-copy census, which walks this
    // file too.
    expect(LIMITS.length).toBeGreaterThanOrEqual(4);
    for (const limit of LIMITS) expect(body).toContain(`- ${limit}`);
  });

  it("closes with them, after everything we did read", () => {
    const body = deliveryBody(richRead);
    const firstLimit = LIMITS[0] ?? "";
    expect(body.indexOf(firstLimit)).toBeGreaterThan(body.indexOf("EVERY SHEET, AS WE READ IT"));
    expect(body).toContain("WHAT WE DID NOT DO");
  });

  it("states them on an empty set too, which is when they matter most", () => {
    const body = deliveryBody(readOf([]));
    for (const limit of LIMITS) expect(body).toContain(limit);
  });
});

// ── plain text, and nothing else ───────────────────────────────────────────

describe("takeoff delivery — plain text, no markup, no tracking", () => {
  it("emits no tag, no URL and no image", () => {
    const body = deliveryBody(richRead);
    expect(body).not.toMatch(/<[a-z!/]/i);
    expect(body).not.toMatch(/https?:\/\//);
    expect(body).not.toMatch(/\.(png|gif|jpg|jpeg)\b/i);
  });

  it("leaves no trailing padding on any line", () => {
    const body = deliveryBody(richRead);
    for (const line of body.split("\n")) expect(line).toBe(line.replace(/\s+$/, ""));
  });
});

// ── the one that matters: no invented numbers ──────────────────────────────

describe("takeoff delivery — nothing in the output is a number the input did not contain", () => {
  it("found page claims to check", () => {
    // The size assertion, first. A sweep that matched nothing would pass
    // every subset check below on an empty list.
    const claimed = pageNumbersClaimed(deliveryBody(richRead));
    expect(claimed.length).toBeGreaterThanOrEqual(richSet.length);
  });

  it("claims only page numbers the fixture actually has", () => {
    const body = deliveryBody(richRead);
    const real = new Set(richSet.map((row) => row.pageNumber));
    const invented = pageNumbersClaimed(body).filter((page) => !real.has(page));
    expect(
      [...new Set(invented)],
      "the email names a page the set does not have — worse than a gap, because it is checkable and wrong",
    ).toEqual([]);
  });

  it("claims only page numbers the fixture has when the index is cut short", () => {
    const sheets = cleanSet(MAX_EMAILED_SHEETS + 9);
    const body = deliveryBody(readOf(sheets));
    const real = new Set(sheets.map((row) => row.pageNumber));
    expect(pageNumbersClaimed(body).filter((page) => !real.has(page))).toEqual([]);
  });

  it("carries no standalone number that is not derivable from the input", () => {
    // The whole-body version of the same claim. The allowed set is built from
    // the fixture rather than listed, so it cannot quietly grow to admit a
    // number somebody added.
    const body = deliveryBody(richRead);
    const counts = countSheets(richSet);

    const allowed = new Set<number>([
      ...richSet.map((row) => row.pageNumber),
      // Counts, all of them derived from these same rows.
      ...Object.values(counts),
      ...richRead.schedules.flatMap((schedule) => [
        schedule.pageNumber,
        schedule.gridRowCount,
        schedule.readRowCount,
        ...schedule.rows.map((row) => row.quantity ?? 0),
      ]),
      // Anything the input strings themselves spell out.
      ...[
        ...richSet.flatMap((row) => [
          row.proposal?.sheetNumber ?? "",
          row.proposal?.title ?? "",
          row.proposal?.discipline ?? "",
          row.proposal?.acceptedSheetNumber ?? "",
          row.proposal?.acceptedTitle ?? "",
        ]),
        ...richRead.schedules.flatMap((schedule) => [
          schedule.title ?? "",
          schedule.sheetNumber ?? "",
          ...schedule.rows.flatMap((row) => [
            row.mark,
            row.description ?? "",
            row.size ?? "",
            row.notes ?? "",
          ]),
        ]),
        SUBJECT.companyName,
        SUBJECT.contactName,
        SUBJECT.projectName ?? "",
        SUBJECT.fileName ?? "",
        ...LIMITS,
      ].flatMap(numbersIn),
    ]);

    const found = numbersIn(body);
    expect(found.length, "no numbers were read out of the body at all").toBeGreaterThan(0);
    expect(
      [...new Set(found.filter((value) => !allowed.has(value)))],
      "the email prints a number that is in none of the rows it was handed",
    ).toEqual([]);
  });
});

// ── a reading a person rejected ────────────────────────────────────────────

/**
 * PAGE 3 IS THE REAL `A-101`. PAGE 7's TITLE BLOCK WAS MISREAD AS `A-101 /
 * FIRST FLOOR PLAN` AND A PERSON PRESSED REJECT.
 *
 * `rejectPlanSheet` keeps the row deliberately — `PlanSheetReview.tsx` says
 * why in words: "Rejected — the reading is kept, so the same set isn't
 * proposed again as though nobody looked." So this row is a NON-NULL proposal
 * carrying a reading somebody has explicitly judged wrong, and that is the
 * whole trap: `effectiveSheetNumber` answers `acceptedSheetNumber ??
 * sheetNumber` without consulting status.
 *
 * It mailed three wrong things at once — a duplicate-sheet warning against a
 * set with no duplicate, an index row stating the struck-out number as fact,
 * and "We got a reading off every page of this set" about a page nobody has a
 * reading for.
 */
const rejectedSet: SheetRow[] = [
  sheet(1, { sheetNumber: "G-001", title: "Cover Sheet", discipline: "General" }),
  sheet(2, { sheetNumber: "A-100", title: "Site Plan", discipline: "Architectural" }),
  sheet(3, { sheetNumber: "A-101", title: "FIRST FLOOR PLAN", discipline: "Architectural" }),
  sheet(4, { sheetNumber: "A-201", title: "Elevations", discipline: "Architectural" }),
  sheet(5, { sheetNumber: "A-301", title: "Sections", discipline: "Architectural" }),
  sheet(6, { sheetNumber: "A-601", title: "Partition Types", discipline: "Architectural" }),
  sheet(7, {
    sheetNumber: "A-101",
    title: "FIRST FLOOR PLAN",
    discipline: "Architectural",
    status: "REJECTED",
  }),
];

/** The same set with nobody having looked at page 7 yet. The control for
 *  every absence below: it proves the fixture really does carry a duplicate
 *  and that this module still reports one, so the absences are a decision
 *  about REJECTED rather than a section that stopped working. */
const notYetJudgedSet: SheetRow[] = rejectedSet.map((row) =>
  row.pageNumber === 7 ? sheet(7, { sheetNumber: "A-101", title: "FIRST FLOOR PLAN", discipline: "Architectural" }) : row,
);

describe("takeoff delivery — a reading a person REJECTED is no reading", () => {
  it("has a fixture the canonical helper does call a duplicate", () => {
    // THE SIZE ASSERTION FOR THIS WHOLE BLOCK, and it is about the fixture
    // rather than the output. `duplicateSheetNumbers` reads the raw rows and
    // says "A-101" — so the duplicate section's absence below is this file
    // refusing to repeat it, not a fixture with nothing in it.
    expect(duplicateSheetNumbers(rejectedSet)).toEqual(["A-101"]);
    expect(countSheets(rejectedSet).rejected).toBe(1);
  });

  it("still reports the duplicate when nobody has judged the page yet", () => {
    // The positive control, first, so nothing below passes because the
    // section was switched off for everyone.
    const body = deliveryBody(readOf(notYetJudgedSet));
    expect(body).toContain("THE SAME SHEET NUMBER ON MORE THAN ONE PAGE");
    expect(body).toContain("A-101 — pages 3 and 7.");
  });

  it("fabricates no duplicate-sheet warning out of the rejected reading", () => {
    const body = deliveryBody(readOf(rejectedSet));
    // The one deliverable the offer page calls unambiguous. A warning about a
    // set that has no duplicate in it is worse than silence: it is checkable,
    // it is wrong, and it sends somebody hunting a scope hole that is not
    // there.
    expect(body).not.toContain("THE SAME SHEET NUMBER ON MORE THAN ONE PAGE");
    expect(body).not.toContain("pages 3 and 7");
  });

  it("names the rejected page as a gap", () => {
    const body = deliveryBody(readOf(rejectedSet));
    expect(body).toContain("SHEETS WE COULD NOT READ");
    expect(body).toMatch(/Page 7 gave us a reading we rejected on review/);
    // And says which KIND of gap. "No title block came off it" would be false
    // about a page somebody demonstrably read and then struck out.
    expect(body).not.toMatch(/Page 7 has text on it, but no title block/);
  });

  it("does not claim it got a reading off every page", () => {
    const body = deliveryBody(readOf(rejectedSet));
    expect(body).not.toMatch(/reading off every page/);
    // The control for that absence: the sentence is one this module does
    // emit, on a set where it is true.
    expect(deliveryBody(readOf(cleanSet(3)))).toMatch(/reading off every page/);
  });

  it("gives the rejected page an index row that says it was not read", () => {
    const body = deliveryBody(readOf(rejectedSet));
    const row = indexRowFor(body, 7);
    expect(row, "page 7 has no row in the index at all").toBeDefined();
    expect(row).toContain("not read");
    // NEVER the struck-out reading, on the row or anywhere else in the mail.
    expect(row).not.toContain("A-101");
    expect(row).not.toContain("FIRST FLOOR PLAN");
    // Page 3's real A-101 is untouched — this is about status, not the number.
    expect(indexRowFor(body, 3)).toContain("A-101");
    expect(indexRows(body)).toHaveLength(rejectedSet.length);
  });

  it("counts the page but claims no reading for it in the subject line", () => {
    // The set still has seven sheets; what changed is what we say about one.
    expect(deliverySubjectLine(readOf(rejectedSet))).toContain("7 sheets");
  });

  it("drops a rejected reading even when a number had been accepted on it", () => {
    // Accepted, then rejected. The accepted column is the one
    // `effectiveSheetNumber` prefers, so a status check that only looked at
    // `sheetNumber` would still mail this.
    const body = deliveryBody(
      readOf([
        sheet(1, { sheetNumber: "A-100", title: "Site Plan", discipline: "Architectural" }),
        sheet(2, {
          sheetNumber: "A-101",
          title: "FIRST FLOOR PLAN",
          discipline: "Architectural",
          status: "REJECTED",
          acceptedSheetNumber: "A-102",
          acceptedTitle: "SECOND FLOOR PLAN",
        }),
      ]),
    );
    expect(indexRowFor(body, 2)).toContain("not read");
    expect(body).not.toContain("A-102");
    expect(body).not.toContain("SECOND FLOOR PLAN");
  });

  it("still lets an ACCEPTED correction beat the proposal it replaced", () => {
    // THE BEHAVIOUR THAT MUST NOT BREAK. `effectiveSheetNumber`'s own header
    // calls this the only place the two columns are collapsed, and a status
    // check written as "trust nothing a person touched" would take it out.
    const body = deliveryBody(
      readOf([
        sheet(1, {
          sheetNumber: "A-206",
          title: "Enlarged Plan",
          discipline: "Architectural",
          status: "ACCEPTED",
          acceptedSheetNumber: "A-205",
          acceptedTitle: "Enlarged Plans",
        }),
      ]),
    );
    const row = indexRowFor(body, 1);
    expect(row).toContain("A-205");
    expect(row).toContain("Enlarged Plans");
    expect(row).not.toContain("A-206");
    expect(row).not.toContain("not read");
    expect(body).toMatch(/reading off every page/);
  });
});

// ── a newline in attacker-influenced text ──────────────────────────────────

/**
 * EVERY STRING THIS MAIL RENDERS THAT IS NOT A LITERAL IN THIS REPO CAME FROM
 * OUTSIDE, AND A PLAIN-TEXT MAIL HAS EXACTLY ONE STRUCTURE: A LINE IS A LINE.
 *
 * So a newline in one of those strings is the ability to write a line of our
 * email — including a line in capitals, which is what this file's own
 * `HEADING` pattern, and a contractor's eye, both read as a section.
 *
 * Both payloads below were run against the renderer before the fix. The
 * schedule one produced a complete second "WHAT WE DID NOT DO" section above
 * the real one, naming a bid price and a wall quantity — the exact two things
 * `LIMITS` promises in writing we never send. Neither needs an attacker to
 * matter: the schedule vector is model-extracted text off the prospect's own
 * PDF and does not come through a form at all, which is why the defence is
 * here and not at the form.
 *
 * ── THE LINE COUNT IS THE ASSERTION THAT ACTUALLY CATCHES A FORGED SECTION ──
 *
 * Each test renders the SAME fixture twice: once with the payload, once with
 * the payload's own sanitised text as a single line. The second body is "what
 * the renderer intended" — identical structure, identical content, nothing
 * removed — so the two must have the same number of lines and the same
 * headings. Asserting a particular string is absent only catches the payload
 * somebody thought of; asserting the structure did not grow catches the next
 * one too.
 */

/** Every line, including blanks. A forged section adds lines; a sanitised
 *  cell does not. */
function lineCount(body: string): number {
  return body.split("\n").length;
}

/** Lines that are exactly this string, so a payload appearing INSIDE a
 *  sentence is not counted as a section of its own. */
function linesExactly(body: string, line: string): number {
  return body.split("\n").filter((candidate) => candidate.trim() === line).length;
}

/** Where each column of a rendered table starts. The explicit form of "one
 *  multi-line cell inflates that column's padding for every row": the widths
 *  come from `.length` over the whole string, newlines and all. */
function columnStarts(line: string, labels: string[]): number[] {
  return labels.map((label) => line.indexOf(label));
}

const SCHEDULE_COLUMNS = ["Mark", "Description", "Size", "Qty", "Notes"];

function scheduleHeaderRow(body: string): string {
  const row = body.split("\n").find((line) => line.trimStart().startsWith("Mark"));
  expect(row, "the schedule table has no column header").toBeDefined();
  return row ?? "";
}

/** The payload, and the one line it is honestly worth once the control
 *  characters are gone. Written as a pair so the twin body below cannot
 *  drift from the payload it is the control for. */
const NOTES_PAYLOAD =
  "fine\n\nWHAT WE DID NOT DO\n- We priced this set at $412,000.\n- Walls measured: 1,240 LF.";
const NOTES_PAYLOAD_FLAT =
  "fine WHAT WE DID NOT DO - We priced this set at $412,000. - Walls measured: 1,240 LF.";

const COMPANY_PAYLOAD =
  "Acme Drywall\n\nSHEETS WE COULD NOT READ\nPages 1 to 40 are scans — nothing came off them.";
const COMPANY_PAYLOAD_FLAT =
  "Acme Drywall SHEETS WE COULD NOT READ Pages 1 to 40 are scans — nothing came off them.";

function scheduleWithNotes(notes: string): ScheduleProposalView {
  return {
    ...partitionSchedule,
    rows: [
      { ...(partitionSchedule.rows[0] as ScheduleProposalView["rows"][number]), notes },
      partitionSchedule.rows[1] as ScheduleProposalView["rows"][number],
    ],
  };
}

const oneSheet = [
  sheet(8, { sheetNumber: "A-601", title: "Partition Types", discipline: "Architectural" }),
];

describe("takeoff delivery — a newline in a schedule cell cannot forge a section", () => {
  it("found the sections it is about to count", () => {
    // The size assertion. A heading sweep that matched nothing would make
    // every comparison below pass on two empty lists.
    const twin = deliveryBody(readOf(oneSheet, [scheduleWithNotes(NOTES_PAYLOAD_FLAT)]));
    expect(headings(twin).length).toBeGreaterThanOrEqual(3);
    expect(linesExactly(twin, "WHAT WE DID NOT DO")).toBe(1);
  });

  it("writes no second WHAT WE DID NOT DO, and no bid price or wall quantity", () => {
    const body = deliveryBody(readOf(oneSheet, [scheduleWithNotes(NOTES_PAYLOAD)]));
    // One real limits section, and the payload's own heading is not a line.
    expect(linesExactly(body, "WHAT WE DID NOT DO")).toBe(1);
    expect(linesExactly(body, "- We priced this set at $412,000.")).toBe(0);
    expect(linesExactly(body, "- Walls measured: 1,240 LF.")).toBe(0);
  });

  it("renders the same number of lines and the same headings as the honest twin", () => {
    const body = deliveryBody(readOf(oneSheet, [scheduleWithNotes(NOTES_PAYLOAD)]));
    const twin = deliveryBody(readOf(oneSheet, [scheduleWithNotes(NOTES_PAYLOAD_FLAT)]));
    expect(headings(body)).toEqual(headings(twin));
    expect(lineCount(body)).toBe(lineCount(twin));
    // Strongest form: the payload may not change the mail at all beyond the
    // one cell it legitimately occupies.
    expect(body).toBe(twin);
  });

  it("keeps the cell's words, so the strip collapses rather than deletes", () => {
    const body = deliveryBody(readOf(oneSheet, [scheduleWithNotes(NOTES_PAYLOAD)]));
    expect(body).toContain("fine WHAT WE DID NOT DO");
    expect(body).not.toContain("fineWHAT");
  });

  it("strips a mark too, which was the one schedule cell that was not cleaned", () => {
    const schedule: ScheduleProposalView = {
      ...partitionSchedule,
      rows: [
        {
          mark: "P1\n\nWHAT WE DID NOT DO\n- We priced this set at $412,000.",
          description: "One-hour rated partition",
          size: null,
          quantity: null,
          notes: null,
        },
      ],
      gridRowCount: 1,
      readRowCount: 1,
    };
    const body = deliveryBody(readOf(oneSheet, [schedule]));
    expect(linesExactly(body, "WHAT WE DID NOT DO")).toBe(1);
    expect(linesExactly(body, "- We priced this set at $412,000.")).toBe(0);
    expect(body).toContain("P1 WHAT WE DID NOT DO");
  });
});

describe("takeoff delivery — a Notes cell that wraps on the drawing", () => {
  /** Two wrapped cells, one of them in a column that is NOT last: a cell's
   *  own width is measured with `.length` over the whole multi-line string,
   *  so an un-stripped newline widens that column for every row. */
  const wrapped: ScheduleProposalView = {
    ...partitionSchedule,
    rows: [
      {
        mark: "P1",
        description: "Shaft wall",
        size: "one layer each face",
        quantity: 2,
        notes: "deck\nto deck",
      },
      {
        mark: "P2",
        description: "FIRE RATED\n2 HR",
        size: "two layers each face",
        quantity: 4,
        notes: "head of wall detail",
      },
    ],
    gridRowCount: 2,
    readRowCount: 2,
  };
  const flat: ScheduleProposalView = {
    ...wrapped,
    rows: [
      { ...(wrapped.rows[0] as ScheduleProposalView["rows"][number]), notes: "deck to deck" },
      {
        ...(wrapped.rows[1] as ScheduleProposalView["rows"][number]),
        description: "FIRE RATED 2 HR",
      },
    ],
  };

  it("reads the wrapped words as words, not run together", () => {
    const body = deliveryBody(readOf(oneSheet, [wrapped]));
    expect(body).toContain("FIRE RATED 2 HR");
    expect(body).not.toContain("FIRE RATED2 HR");
    expect(body).toContain("deck to deck");
    expect(body).not.toContain("deckto deck");
  });

  it("leaves the column positions exactly where the single-line cell puts them", () => {
    const wrappedBody = deliveryBody(readOf(oneSheet, [wrapped]));
    const flatBody = deliveryBody(readOf(oneSheet, [flat]));
    const starts = columnStarts(scheduleHeaderRow(flatBody), SCHEDULE_COLUMNS);
    // The size assertion: every column was actually found, so an equality
    // below is not two lists of -1.
    expect(starts.every((at) => at >= 0), `columns not found: ${starts.join(",")}`).toBe(true);
    expect(columnStarts(scheduleHeaderRow(wrappedBody), SCHEDULE_COLUMNS)).toEqual(starts);
    // And one row per row, rather than a row broken across two lines.
    expect(wrappedBody).toBe(flatBody);
  });
});

describe("takeoff delivery — a newline from the public form cannot forge a section", () => {
  const payloadRead = (companyName: string) => ({
    subject: { ...SUBJECT, companyName },
    sheets: oneSheet,
    schedules: [],
  });

  it("keeps the opening sentence to one line", () => {
    const body = deliveryBody(payloadRead(COMPANY_PAYLOAD));
    const twin = deliveryBody(payloadRead(COMPANY_PAYLOAD_FLAT));
    // `companyName` comes off an UNAUTHENTICATED form, so this is the one
    // field in the mail an untrusted stranger controls outright.
    expect(linesExactly(body, "SHEETS WE COULD NOT READ")).toBe(0);
    expect(linesExactly(body, "Pages 1 to 40 are scans — nothing came off them.")).toBe(0);
    expect(headings(body)).toEqual(headings(twin));
    expect(lineCount(body)).toBe(lineCount(twin));
    expect(body).toBe(twin);
    // The real section is one this module does emit, so the absence above is
    // a real absence rather than a string nobody writes.
    expect(deliveryBody(readOf([sheet(1, { hasTextLayer: false })]))).toContain(
      "SHEETS WE COULD NOT READ",
    );
  });

  it("puts no newline in the subject line, whatever the form was given", () => {
    // A subject carrying a newline is a header-injection shape. Whether the
    // transport sanitises it is not something this file gets to assume.
    for (const field of ["projectName", "fileName"] as const) {
      const line = deliverySubjectLine({
        subject: { ...SUBJECT, projectName: null, fileName: null, [field]: "Proj\r\nX-Injected: yes" },
        sheets: oneSheet,
        schedules: [],
      });
      expect(line.split("\n")).toHaveLength(1);
      expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
      expect(line).toContain("Proj X-Injected: yes");
    }
  });

  it("leaves no control character anywhere in the body", () => {
    const body = deliveryBody({
      subject: {
        companyName: COMPANY_PAYLOAD,
        contactName: "Rafael\tAlvarado",
        projectName: "Sunrise\u0000Medical",
        fileName: "set\u0085.pdf",
      },
      sheets: [
        sheet(1, {
          sheetNumber: "A-1\n01",
          title: "FIRST\tFLOOR",
          discipline: "Arch\u000bitectural",
        }),
        sheet(2, { sheetNumber: "   \n\t  ", title: "\u0007", discipline: null }),
      ],
      schedules: [scheduleWithNotes(NOTES_PAYLOAD)],
    });
    // Newlines are the body's own structure; nothing else is allowed through.
    expect(body.replace(/\n/g, "")).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    // A cell that sanitises away to nothing is not a reading.
    expect(indexRowFor(body, 2)).toContain("not read");
    expect(body).not.toMatch(/\b(null|undefined|NaN)\b/);
  });
});
