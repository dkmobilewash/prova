import { describe, expect, it } from "vitest";
import type { PlanTextItem } from "@/lib/plan-ingest/planPdf";
import { describePageRuns, linesFromItems, pageIsReadable, pageTextsFromJson, unreadPageNumbers } from "./pageText";

const item = (str: string, x: number, y: number, width = str.length * 5, height = 10): PlanTextItem => ({
  str,
  x,
  y,
  width,
  height,
});

describe("linesFromItems", () => {
  it("joins fragments on one baseline in x order, splitting a word only where the gap is a space", () => {
    // pdf.js arrives out of order and splits "Subcontractor" across a kerning change.
    const lines = linesFromItems([
      item("shall", 120, 100),
      item("Subcon", 50, 100, 30),
      item("tractor", 80, 100, 35),
      item("pay", 152, 100),
    ]);
    expect(lines).toEqual(["Subcontractor shall pay"]);
  });

  it("orders lines top to bottom and tolerates a baseline wobble", () => {
    expect(linesFromItems([item("second", 50, 120), item("first", 50, 100.5), item("line", 80, 101)])).toEqual([
      "first line",
      "second",
    ]);
  });

  it("reads a two-column page column by column, not straight across", () => {
    const items: PlanTextItem[] = [];
    for (let row = 0; row < 6; row++) {
      items.push(item(`left ${row}`, 50, 100 + row * 14));
      items.push(item(`right ${row}`, 320, 100 + row * 14));
    }
    expect(linesFromItems(items)).toEqual([
      "left 0", "left 1", "left 2", "left 3", "left 4", "left 5",
      "right 0", "right 1", "right 2", "right 3", "right 4", "right 5",
    ]);
  });

  it("keeps a single-column page with the odd wide gap (a table row) as lines", () => {
    const items = [
      item("Article 1 sets out the work to be performed by the subcontractor.", 50, 100),
      item("Contract Sum", 50, 114),
      item("$412,000", 400, 114),
      item("The work shall be completed in accordance with the schedule.", 50, 128),
      item("All notices shall be in writing.", 50, 142),
    ];
    expect(linesFromItems(items)).toEqual([
      "Article 1 sets out the work to be performed by the subcontractor.",
      "Contract Sum  $412,000",
      "The work shall be completed in accordance with the schedule.",
      "All notices shall be in writing.",
    ]);
  });

  it("returns nothing for a page with no text items", () => {
    expect(linesFromItems([])).toEqual([]);
    expect(linesFromItems([item("   ", 0, 0)])).toEqual([]);
  });
});

describe("pageIsReadable", () => {
  it("treats a stamped page number on a scan as unread", () => {
    expect(pageIsReadable(["Page 4"])).toBe(false);
    expect(pageIsReadable(["Subcontractor shall maintain insurance."])).toBe(true);
  });
});

describe("unread pages", () => {
  it("names the 1-based pages with no text and round-trips through JSON", () => {
    const pages = [["a line of text here that is long"], null, null, ["more"], null];
    expect(unreadPageNumbers(pages)).toEqual([2, 3, 5]);
    expect(pageTextsFromJson(JSON.parse(JSON.stringify(pages)))).toEqual(pages);
    expect(pageTextsFromJson("nonsense")).toEqual([]);
  });

  it("describes runs of pages the way a person reads them", () => {
    expect(describePageRuns([5, 3, 4, 9, 11, 12])).toBe("3–5, 9, 11–12");
    expect(describePageRuns([])).toBe("");
  });
});
