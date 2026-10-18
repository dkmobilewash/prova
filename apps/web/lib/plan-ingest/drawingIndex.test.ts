import { describe, expect, it } from "vitest";
import {
  compareIndex,
  indexCheck,
  indexSentence,
  readDrawingIndex,
  unreadPageCount,
  type DrawingIndex,
} from "./drawingIndex";
import type { PlanPageText, PlanTextItem } from "./planPdf";

/**
 * NO CUSTOMER DRAWING IS A FIXTURE — plan sets are confidential and never go in
 * a test. The pages here are built by these helpers to the SHAPES measured on
 * six real sets, and those measurements are in `drawingIndex.ts`'s header.
 */

const item = (str: string, x: number, y: number): PlanTextItem => ({
  str,
  x,
  y,
  width: str.length * 5,
  height: 9,
});

const page = (pageNumber: number, items: PlanTextItem[]): PlanPageText => ({
  pageNumber,
  widthPt: 2592,
  heightPt: 1728,
  rotation: 0,
  items,
});

/** An index table: a column of sheet numbers at `x`, each with a title beside
 *  it, which is how every real one is laid out. */
function indexColumn(numbers: string[], x = 200, top = 300): PlanTextItem[] {
  return numbers.flatMap((number, row) => [
    item(number, x, top + row * 20),
    item(`SOME DRAWING TITLE ${row}`, x + 120, top + row * 20),
  ]);
}

describe("readDrawingIndex", () => {
  it("reads a column of sheet numbers off the cover", () => {
    const numbers = ["G001", "A100", "A101", "A102", "A201", "S100"];
    const index = readDrawingIndex([page(1, indexColumn(numbers))]);
    expect(index).not.toBeNull();
    expect(index?.pageNumber).toBe(1);
    expect(index?.listed).toEqual(numbers);
  });

  it("FINDS AN INDEX THAT IS NOT ON PAGE ONE", () => {
    // Measured: Augusta's index is on page 2 and SRFR's is on page 2. Scanning
    // only the cover found nothing on either, which is how this was nearly
    // shipped reading three sets out of six.
    const cover = page(1, [item("SOME PROJECT", 400, 400), item("ISSUED FOR BID", 400, 500)]);
    const second = page(2, indexColumn(["G001", "A100", "A101", "A102", "A201"]));
    const index = readDrawingIndex([cover, second]);
    expect(index?.pageNumber).toBe(2);
    expect(index?.listed).toHaveLength(5);
  });

  it("IGNORES A LEGEND OF DRAWING SYMBOLS BESIDE THE INDEX", () => {
    // The whole reason this file clusters by x. On SRFR the shape alone found
    // 101 numbers for a 93-page set: `F1`, `W1`, `S1`, `R1`, `GL-1`, `EQP-1`,
    // `FIN-1` all read exactly like sheet numbers.
    //
    // Requiring a TITLE beside the number — the obvious fix — changed nothing,
    // because a legend is a table too. That is recorded here because it is the
    // discriminator somebody will reach for next.
    //
    // THE SIZES ARE SRFR'S, not round numbers: a real index is dozens of rows
    // and a real legend is a handful. The first version of this test used 8
    // against 4 and failed, which is the rule working rather than the rule
    // being wrong — see the bound recorded below it.
    const sheets = Array.from({ length: 40 }, (_, i) => `A${100 + i}`);
    const realIndex = indexColumn(sheets, 200);
    const legend = indexColumn(["F1", "W1", "S1", "R1", "GL-1", "EQP-1", "FIN-1"], 1800);
    const index = readDrawingIndex([page(1, [...realIndex, ...legend])]);
    expect(index?.listed).toEqual(sheets);
    expect(index?.listed).not.toContain("F1");
    expect(index?.listed).not.toContain("GL-1");
  });

  it("CANNOT TELL A LEGEND FROM A SMALL INDEX, and this records where the line is", () => {
    // The bound, written down rather than left to be discovered. A column
    // counts as index when it stands comparison with the tallest, so a legend
    // beside a SHORT index is indistinguishable — here a 4-row legend beside
    // an 8-sheet index comes back as 12.
    //
    // Left this way on purpose. The alternative is a higher floor, which would
    // throw away the second and third columns of a genuinely multi-column
    // index — Naples lists 52 sheets across three, and keeping only the
    // tallest column reported 18. A set small enough to hit this is a set
    // somebody can check by eye in a minute; a 52-sheet set silently reporting
    // 18 is not.
    const index = readDrawingIndex([
      page(1, [
        ...indexColumn(["A100", "A101", "A102", "A103", "A104", "A105", "A106", "A107"], 200),
        ...indexColumn(["F1", "W1", "S1", "R1"], 1800),
      ]),
    ]);
    expect(index?.listed).toHaveLength(12);
  });

  it("READS AN INDEX LAID OUT IN SEVERAL COLUMNS", () => {
    // Naples splits 52 sheets across three columns. Keeping only the BIGGEST
    // column — which is what fixes the legend case above — took it from 52 to
    // 18, so the rule has to be every column comparable to the tallest.
    const left = indexColumn(["G001", "G002", "G003", "G004", "G005"], 200);
    const middle = indexColumn(["A100", "A101", "A102", "A103", "A104"], 900);
    const right = indexColumn(["S100", "S101", "S102", "S103", "S104"], 1600);
    const index = readDrawingIndex([page(1, [...left, ...middle, ...right])]);
    expect(index?.listed).toHaveLength(15);
    expect(index?.listed).toContain("G001");
    expect(index?.listed).toContain("A104");
    expect(index?.listed).toContain("S102");
  });

  it("RETURNS NULL ON A PAGE WITH NO TEXT LAYER, which is not an empty index", () => {
    // West Herr's cover is a raster scan: zero text items. `null` means WE
    // COULD NOT CHECK. An empty list would mean NOTHING IS MISSING, and
    // reporting the second when the first is true is the failure this whole
    // file is arranged around.
    expect(readDrawingIndex([page(1, [])])).toBeNull();
    expect(readDrawingIndex([])).toBeNull();
  });

  it("returns null rather than calling two stray labels an index", () => {
    const index = readDrawingIndex([page(1, [...indexColumn(["A100", "A101"]), item("NOTES", 900, 300)])]);
    expect(index).toBeNull();
  });

  it("does not look past the first few pages", () => {
    // A 93-page set should not be scanned to find a table that is always near
    // the front. The index here is on page 9 and is deliberately not found.
    const pages = [
      ...Array.from({ length: 8 }, (_, i) => page(i + 1, [item("PLAN", 400, 400)])),
      page(9, indexColumn(["A100", "A101", "A102", "A103"])),
    ];
    expect(readDrawingIndex(pages)).toBeNull();
  });
});

describe("compareIndex", () => {
  const index: DrawingIndex = { pageNumber: 1, listed: ["G001", "A100", "A101", "A102"] };

  it("NAMES THE SHEETS THE SET LISTS AND NOBODY UPLOADED", () => {
    // The defect this feature exists for: a bid priced off an incomplete set.
    const result = compareIndex(index, ["G001", "A100"]);
    expect(result.missing).toEqual(["A101", "A102"]);
    expect(result.unlisted).toEqual([]);
  });

  it("names a page that is here and not in the index, without calling it wrong", () => {
    // An addendum sheet arrives exactly like this.
    const result = compareIndex(index, ["G001", "A100", "A101", "A102", "A103"]);
    expect(result.missing).toEqual([]);
    expect(result.unlisted).toEqual(["A103"]);
  });

  it("does not care about punctuation a set is not consistent about", () => {
    // `A1.1` and `A-1.1` are the same sheet and no estimator thinks otherwise.
    const dotted: DrawingIndex = { pageNumber: 1, listed: ["A-1.1", "A-1.2"] };
    expect(compareIndex(dotted, ["A1.1", "A1.2"]).missing).toEqual([]);
  });

  it("shows the number the DRAWING printed, not the normalised one", () => {
    const dotted: DrawingIndex = { pageNumber: 1, listed: ["A-1.1"] };
    expect(compareIndex(dotted, []).missing).toEqual(["A-1.1"]);
  });

  it("ignores pages whose sheet number was never read", () => {
    // A page with no title block read yet is `null`, and counting it as a
    // sheet named "" would make every listed sheet look present.
    const result = compareIndex(index, ["G001", null, "   ", null]);
    expect(result.missing).toEqual(["A100", "A101", "A102"]);
    expect(result.haveCount).toBe(1);
  });
});

describe("indexSentence", () => {
  it("SAYS IT COULD NOT CHECK, rather than saying nothing", () => {
    const sentence = indexSentence(null, null);
    expect(sentence).toContain("Couldn't read");
    expect(sentence).toContain("by eye");
    // It must never read as an all-clear.
    expect(sentence).not.toMatch(/all .* are here/);
  });

  it("says where the index was, because it is often not the cover", () => {
    const index: DrawingIndex = { pageNumber: 2, listed: ["A100", "A101"] };
    expect(indexSentence(index, compareIndex(index, ["A100", "A101"]))).toContain("page 2");
    const onCover: DrawingIndex = { pageNumber: 1, listed: ["A100"] };
    expect(indexSentence(onCover, compareIndex(onCover, ["A100"]))).toContain("the cover");
  });

  it("names the missing sheets in the sentence itself", () => {
    const index: DrawingIndex = { pageNumber: 1, listed: ["A100", "A101", "A102"] };
    const sentence = indexSentence(index, compareIndex(index, ["A100"]));
    expect(sentence).toContain("A101");
    expect(sentence).toContain("A102");
    expect(sentence).toContain("NOT in what was uploaded");
  });

  it("does not print forty sheet numbers into one sentence", () => {
    const many = Array.from({ length: 40 }, (_, i) => `A${100 + i}`);
    const index: DrawingIndex = { pageNumber: 1, listed: many };
    const sentence = indexSentence(index, compareIndex(index, []));
    expect(sentence).toContain("and 28 more");
    expect(sentence.length).toBeLessThan(400);
  });
});

describe("indexCheck", () => {
  const index: DrawingIndex = { pageNumber: 2, listed: ["A100", "A101", "A102"] };
  const sheet = (proposed: string | null, accepted: string | null = null, page = 1) => ({
    // The page is what the counter counts, so a fixture without one collapses
    // every sheet onto page `undefined` and the count comes out at 1.
    pageNumber: page,
    proposedSheetNumber: proposed,
    acceptedSheetNumber: accepted,
  });

  it("HONOURS A PERSON'S CORRECTION over the machine's guess", () => {
    // Found by mutation: comparing against `proposedSheetNumber` alone passed
    // every screen test, and would report somebody's OWN correction back to
    // them as a missing sheet. The title block was misread as A1O2 with a
    // letter O; they fixed it to A102; the index lists A102.
    const result = indexCheck(index, [sheet("A100"), sheet("A101"), sheet("A1O2", "A102")]);
    expect(result.missing).toEqual([]);
  });

  it("still uses the machine's guess when nobody has said otherwise", () => {
    const result = indexCheck(index, [sheet("A100"), sheet("A101")]);
    expect(result.missing).toEqual(["A102"]);
  });

  it("REPORTS NULL, NOT AN EMPTY LIST, WHEN NO INDEX COULD BE READ", () => {
    // The other mutation that was green: returning `missing: []` here says
    // "nothing is missing" when the truth is "we could not check". Null is how
    // that stays unsayable — a caller cannot read it as an all-clear by
    // accident, and the type will not let them call `.length` on it.
    const result = indexCheck(null, [sheet("A100")]);
    expect(result.missing).toBeNull();
    expect(result.unlisted).toBeNull();
    expect(result.onPage).toBeNull();
    expect(result.sentence).toContain("Couldn't read");
  });

  it("carries the page the index was found on", () => {
    expect(indexCheck(index, [sheet("A100")]).onPage).toBe(2);
  });
});

describe("sheets nobody has read yet", () => {
  const unreadIndex: DrawingIndex = { pageNumber: 2, listed: ["A100", "A101", "A102", "A103"] };
  let nextPage = 0;
  const unreadSheet = (proposed: string | null) => ({
    pageNumber: (nextPage += 1),
    proposedSheetNumber: proposed,
    acceptedSheetNumber: null,
  });
  // A set with `n` pages of which `unread` have no number, written as the
  // counter returns it. Spelling the shape out per test is what caught the
  // production bug being fed a constant.
  const unread = (pages: number, total: number, unnamed = 0) => ({
    pages,
    total,
    noReading: total - unnamed,
    unnamed,
  });

  it("REFUSES THE COMPARISON rather than calling unread sheets missing", () => {
    // Found on production the day this shipped. Reading had paused at 21 of 55
    // sheets, so 34 pages had no number — and the screen named twelve real
    // drawings as NOT IN WHAT WAS UPLOADED, plus "and 27 more". Every one was
    // sitting in the file.
    //
    // It is the distinction this module was built around, applied the wrong
    // way: careful that "the index could not be read" must never read as
    // "nothing is missing", and then letting "the PAGES have not been read"
    // read as "everything is missing".
    const result = indexCheck(unreadIndex, [unreadSheet("A100")], unread(35, 34));
    expect(result.missing).toBeNull();
    expect(result.unlisted).toBeNull();
    expect(result.sentence).toContain("34 of these 35 sheets");
    expect(result.sentence).toContain("no number yet");
    // THE ACTION, not a wait — see the Naples case below.
    expect(result.sentence).toContain("Read the title blocks");
  });

  it("does not quietly report a PARTIAL answer", () => {
    // Half an answer is worse than none: an estimator told four sheets are
    // missing goes to the GC, and finding them in the file is how a check
    // stops being read at all.
    const result = indexCheck(unreadIndex, [unreadSheet("A100")], unread(4, 3));
    expect(result.sentence).not.toContain("NOT in what was uploaded");
    expect(result.missing).toBeNull();
  });

  it("still says WHERE the index was, which is true either way", () => {
    expect(indexCheck(unreadIndex, [unreadSheet("A100")], unread(4, 3)).onPage).toBe(2);
  });

  it("gets the singular right for one unread sheet", () => {
    expect(indexCheck(unreadIndex, [unreadSheet("A100")], unread(2, 1)).sentence).toContain(
      "1 of these 2 sheets has no number yet",
    );
  });

  it("NAMES THE TITLE-BLOCK READ, not a wait, on a set whose pages ARE all read", () => {
    // Naples, found by a browser run. The review line above said
    // "53 of 53 sheets (100%) — 1 couldn't be read · Finished" and this said
    // "let the reading finish". Page reading HAD finished; what had not run
    // was the title-block read, which is the stage that assigns numbers and is
    // a button somebody has to press.
    //
    // Pointing at a wait for something already done is this module's own
    // failure mode a third time: a sentence that sounds true and sends nobody
    // anywhere useful.
    const result = indexCheck(unreadIndex, [unreadSheet("A100")], unread(53, 52));
    expect(result.sentence).toContain("Read the title blocks");
    expect(result.sentence, "nothing is waiting on the page read").not.toContain("reading finish");
    expect(result.missing).toBeNull();
  });

  it("RECONCILES WITH THE REVIEW LINE by naming the split out loud", () => {
    // Augusta, same run: this said 25 and the line above it said 23. Both
    // right, counting different things, and the screen looked broken. The
    // parenthetical is what makes the arithmetic followable.
    const result = indexCheck(unreadIndex, [unreadSheet("A100")], unread(55, 25, 2));
    expect(result.sentence).toContain("25 of these 55 sheets");
    expect(result.sentence).toContain("23 not read");
    expect(result.sentence).toContain("2 the reader couldn't name");
  });

  it("spends no words on the split when there is nothing to reconcile", () => {
    // Every unread page is simply unreached, so there is no second number on
    // the screen to disagree with and no parenthetical earns its space.
    const result = indexCheck(unreadIndex, [unreadSheet("A100")], unread(55, 25, 0));
    expect(result.sentence).toContain("25 of these 55 sheets");
    expect(result.sentence).not.toContain("not read,");
  });

  it("AN UNREADABLE INDEX STILL WINS over unread pages", () => {
    // Both are "cannot check", and the index one is the more fundamental: with
    // no index there is nothing to compare against however much has been read.
    // Mutation found this order was reversible with every test green.
    const result = indexCheck(null, [unreadSheet("A100")], unread(55, 25));
    expect(result.sentence).toContain("Couldn't read");
    expect(result.sentence).not.toContain("no number yet");
    expect(result.onPage).toBeNull();
  });

  it("COMPARES NORMALLY once everything has been read", () => {
    const result = indexCheck(unreadIndex, ["A100", "A101", "A102", "A103"].map(unreadSheet), unread(4, 0));
    expect(result.missing).toEqual([]);
    expect(result.sentence).toContain("all 4 are here");
  });

  it("names what is missing once everything has been read", () => {
    const result = indexCheck(unreadIndex, [unreadSheet("A100"), unreadSheet("A101")], unread(2, 0));
    expect(result.missing).toEqual(["A102", "A103"]);
  });

  it("an unreadable index still wins over an unread count", () => {
    // Nothing can be said about a set whose index nobody could read, however
    // many of its pages have been.
    const result = indexCheck(null, [unreadSheet("A100")], unread(35, 34));
    expect(result.sentence).toContain("Couldn't read");
    expect(result.onPage).toBeNull();
  });
});

describe("unreadPageCount", () => {
  const read = (n: string, page = 1) => ({ pageNumber: page, proposedSheetNumber: n, acceptedSheetNumber: null });
  const nameless = (page: number) => ({ pageNumber: page, proposedSheetNumber: null, acceptedSheetNumber: null });

  it("counts the pages with no number against the pages in the set", () => {
    expect(unreadPageCount(55, [read("A100", 1), read("A101", 2)]).total).toBe(53);
    expect(unreadPageCount(2, [read("A100", 1), read("A101", 2)]).total).toBe(0);
  });

  it("COUNTS A PAGE THE READER COULD NOT NAME AS UNREAD", () => {
    // Found by mutation: counting PROPOSALS rather than numbered ones passed
    // every test, and a page the model read but could not name would count as
    // read — so the index's entry for it comes back MISSING. That is the
    // production bug wearing a different hat.
    expect(unreadPageCount(3, [read("A100", 1), nameless(2), nameless(3)]).total).toBe(2);
  });

  // ── THE SPLIT, AND WHY IT IS NOT DECORATION ────────────────────────────
  //
  // A browser run found the first version's single number CONTRADICTING the
  // review line above it: this said 25 unread, that said "23 need their
  // numbers typed in". Both were right about different things. The split is
  // what lets the sentence say so instead of looking broken.

  it("SEPARATES pages nobody reached from pages it could not name", () => {
    const counts = unreadPageCount(10, [read("A100", 1), nameless(2), nameless(3)]);
    expect(counts.total, "nine pages have no number").toBe(9);
    expect(counts.unnamed, "two were reached and came back nameless").toBe(2);
    expect(counts.noReading, "seven were never reached").toBe(7);
    expect(counts.noReading + counts.unnamed, "the split has to add up").toBe(counts.total);
  });

  it("carries the page total, which is what the sentence anchors on", () => {
    expect(unreadPageCount(55, [read("A100", 1)]).pages).toBe(55);
  });

  it("reports no unnamed pages when every proposal has a number", () => {
    const counts = unreadPageCount(10, [read("A100", 1), read("A101", 2)]);
    expect(counts.unnamed).toBe(0);
    expect(counts.noReading).toBe(8);
  });

  it("treats a blank number as no number", () => {
    expect(
      unreadPageCount(2, [read("A100", 1), { pageNumber: 2, proposedSheetNumber: "   ", acceptedSheetNumber: null }])
        .total,
    ).toBe(1);
  });

  it("takes an accepted number when the proposal had none", () => {
    expect(unreadPageCount(1, [{ pageNumber: 1, proposedSheetNumber: null, acceptedSheetNumber: "A100" }]).total).toBe(
      0,
    );
  });

  it("COUNTS PAGES, NOT PROPOSALS, when the reader has been re-run", () => {
    // A re-run leaves two rows on one page. Counting rows made two pages look
    // read when one was, so the unread count came out LOW — and `Math.max(0,
    // …)` hid it by flooring the answer at nothing to do.
    expect(unreadPageCount(3, [read("A100", 1), read("A100", 1), read("A101", 2)]).total).toBe(1);
  });

  it("IS NEVER NEGATIVE when there are more read pages than page rows", () => {
    // A negative would read as "everything is read" to any caller testing
    // `> 0`, which is the production bug with a sign on it.
    const counts = unreadPageCount(1, [read("A100", 1), read("A101", 2), read("A102", 3)]);
    expect(counts.total).toBe(0);
    expect(counts.noReading).toBe(0);
  });

  it("says every page is unread when nothing has been read", () => {
    const counts = unreadPageCount(55, []);
    expect(counts.total).toBe(55);
    expect(counts.noReading, "none of them was reached, so none is unnamed").toBe(55);
    expect(counts.unnamed).toBe(0);
  });
});
