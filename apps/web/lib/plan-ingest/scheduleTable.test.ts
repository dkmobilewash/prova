import { describe, expect, it } from "vitest";
import { gridText, looksLikeTable, tableRowsFromPage, type TableRow } from "./scheduleTable";
import type { PlanPageText, PlanTextItem } from "./planPdf";

/**
 * The deterministic half of schedule parsing, tested to the character.
 *
 * Every number in these fixtures is points — 72 to the inch — and every case is
 * a shape a real door schedule has. The model is not involved and neither is a
 * PDF: this file answers "which strings are on the same row, and in what order",
 * which is the question that has to be right before a model is asked anything.
 */

/** A text item. `width` is set from the string so the gap maths is realistic:
 *  ~6 points per character is 12pt type, which is what a schedule is set in. */
function item(str: string, x: number, y: number, charWidth = 6, height = 12): PlanTextItem {
  return { str, x, y, width: str.length * charWidth, height };
}

function page(items: PlanTextItem[]): PlanPageText {
  return { pageNumber: 1, widthPt: 36 * 72, heightPt: 24 * 72, rotation: 0, items };
}

/** A three-row door schedule: header plus two doors, four columns. */
const DOOR_SCHEDULE = page([
  item("MARK", 100, 100),
  item("SIZE", 300, 100),
  item("TYPE", 500, 100),
  item("RATING", 700, 100),

  item("101", 100, 130),
  item("3'-0\" x 7'-0\"", 300, 130),
  item("HOLLOW METAL", 500, 130),
  item("90 MIN", 700, 130),

  item("102", 100, 160),
  item("2'-8\" x 7'-0\"", 300, 160),
  item("WOOD", 500, 160),
  item("—", 700, 160),
]);

describe("rows come back as rows", () => {
  it("groups items that share a baseline, in reading order", () => {
    const rows = tableRowsFromPage(DOOR_SCHEDULE);
    expect(rows).toHaveLength(3);
    expect(rows[0].cells).toEqual(["MARK", "SIZE", "TYPE", "RATING"]);
    expect(rows[1].cells).toEqual(["101", "3'-0\" x 7'-0\"", "HOLLOW METAL", "90 MIN"]);
    expect(rows[2].cells).toEqual(["102", "2'-8\" x 7'-0\"", "WOOD", "—"]);
  });

  it("orders rows top to bottom whatever order the PDF reported them in", () => {
    // pdfjs reports items in content-stream order, which is the order the CAD
    // package wrote them — frequently column by column, not row by row.
    const shuffled = page([...DOOR_SCHEDULE.items].reverse());
    const rows = tableRowsFromPage(shuffled);
    expect(rows.map((r) => r.cells[0])).toEqual(["MARK", "101", "102"]);
  });

  it("keeps a cell whose text pdfjs split into several items as ONE cell", () => {
    // "HOLLOW METAL" arrives as two items a space apart. Joined with a single
    // space — never concatenated, which would read "HOLLOWMETAL".
    const rows = tableRowsFromPage(
      page([item("MARK", 100, 100), item("HOLLOW", 300, 100), item("METAL", 342, 100)]),
    );
    expect(rows[0].cells).toEqual(["MARK", "HOLLOW METAL"]);
  });

  it("DOES NOT SPLIT a size cell on its internal spaces, which is what the tolerance was chosen against", () => {
    // `3'-0" x 7'-0"` is one value. A gap tolerance of one character cut it
    // into three cells and made every door twice as wide as it is.
    const rows = tableRowsFromPage(
      page([item("101", 100, 100), item("3'-0\"", 300, 100), item("x", 336, 100), item("7'-0\"", 348, 100)]),
    );
    expect(rows[0].cells).toEqual(["101", "3'-0\" x 7'-0\""]);
  });
});

describe("baselines that drift", () => {
  it("holds a row together when its cells sit a point or two apart", () => {
    // A fraction set smaller than its row sits on a slightly different baseline.
    const rows = tableRowsFromPage(
      page([item("101", 100, 130), item("3'-0\"", 300, 132), item("HM", 500, 129)]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toEqual(["101", "3'-0\"", "HM"]);
  });

  it("does NOT merge two real rows one line apart", () => {
    const rows = tableRowsFromPage(page([item("101", 100, 130), item("102", 100, 160)]));
    expect(rows).toHaveLength(2);
  });

  it("compares against the row's FIRST member, so a long row cannot walk into the next", () => {
    // Twelve cells each drifting 2pt from its neighbour would reach 24pt — two
    // whole rows — if each were compared to the one before it.
    const drifting = Array.from({ length: 12 }, (_, i) => item(`c${i}`, 100 + i * 100, 130 + i * 2));
    const rows = tableRowsFromPage(page(drifting));
    // The later cells fall outside the anchor's tolerance and start a new row,
    // which is correct: 24pt below the first cell is not the same line. What
    // must NOT happen is one row of twelve swallowing the rows beneath it.
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0].cells.length).toBeLessThan(12);
  });
});

describe("the grid handed to the model", () => {
  it("is one row per line, cells separated by a pipe", () => {
    const text = gridText(tableRowsFromPage(DOOR_SCHEDULE));
    expect(text.split("\n")).toHaveLength(3);
    expect(text.split("\n")[1]).toBe("101 | 3'-0\" x 7'-0\" | HOLLOW METAL | 90 MIN");
  });

  it("escapes a pipe that appears in a cell, so the separator cannot lie", () => {
    const rows: TableRow[] = [{ y: 0, cells: ["A|B", "C"] }];
    expect(gridText(rows)).toBe("A\\|B | C");
  });

  it("survives inch marks and quotes without escaping them", () => {
    // These are the characters a schedule is full of. A format that needed them
    // escaped would be one more thing to get wrong.
    const text = gridText(tableRowsFromPage(DOOR_SCHEDULE));
    expect(text).toContain("3'-0\" x 7'-0\"");
  });
});

describe("is it worth paying a model for", () => {
  it("calls a real schedule a table", () => {
    expect(looksLikeTable(tableRowsFromPage(DOOR_SCHEDULE))).toBe(true);
  });

  it("does NOT call a page of prose a table", () => {
    // A general-notes sheet: many rows, one cell each. Sending it to a model to
    // be told it holds no schedule costs the same as sending a real one.
    const prose = page(
      Array.from({ length: 20 }, (_, i) =>
        item(`All work shall comply with the requirements of paragraph ${i}.`, 100, 100 + i * 20),
      ),
    );
    expect(looksLikeTable(tableRowsFromPage(prose))).toBe(false);
  });

  it("is generous rather than strict, because refusing a real schedule is the worse error", () => {
    // Three rows of two cells is the floor. A small finish schedule looks like
    // this, and a silent gap in a bid costs more than a wasted model call.
    const small = page([
      item("ROOM", 100, 100),
      item("FINISH", 300, 100),
      item("101", 100, 130),
      item("PT-1", 300, 130),
      item("102", 100, 160),
      item("PT-2", 300, 160),
    ]);
    expect(looksLikeTable(tableRowsFromPage(small))).toBe(true);
  });

  it("says no to an empty page rather than throwing", () => {
    expect(tableRowsFromPage(page([]))).toEqual([]);
    expect(looksLikeTable([])).toBe(false);
  });

  it("ignores items that carry no ink", () => {
    // pdfjs reports positioning items with empty or whitespace strings. A row
    // made of those is not a row.
    const rows = tableRowsFromPage(page([item("", 100, 100), item("   ", 300, 100), item("101", 500, 100)]));
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toEqual(["101"]);
  });
});
