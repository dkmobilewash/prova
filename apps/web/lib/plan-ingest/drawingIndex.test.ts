import { describe, expect, it } from "vitest";
import { compareIndex, indexCheck, indexSentence, readDrawingIndex, type DrawingIndex } from "./drawingIndex";
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
  const sheet = (proposed: string | null, accepted: string | null = null) => ({
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
