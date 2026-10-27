import { describe, expect, it } from "vitest";

import type { SheetRow } from "@/lib/plan-ingest/sheetIndex";
import {
  looksLikeFloorPlan,
  printedScaleOffers,
  UNFILED,
  buildSheetTree,
  disciplineName,
  disciplineOf,
  scaleStatusOf,
  takeoffProgress,
} from "./sheetTree";

/**
 * Every number in this file comes from a real set that has been through the
 * pipeline on this branch — Camp Bow Wow (29 sheets) and Eleven03 (175) — so
 * the odd sheet numbers are not invented to make a case: `A4.B.1`, `H-96037`
 * and the untitled scans are all shapes that actually arrived.
 */

function row(over: Partial<SheetRow> & { pageNumber: number }): SheetRow {
  const { proposal, ...rest } = over;
  return {
    hasTextLayer: true,
    proposal: null,
    ...rest,
    ...(proposal === undefined ? {} : { proposal }),
  } as SheetRow;
}

function proposal(over: Record<string, unknown>) {
  return {
    id: "p1",
    sheetNumber: null,
    title: null,
    discipline: null,
    pageType: null,
    scale: null,
    revision: null,
    issueDate: null,
    reason: "",
    confidence: "HIGH",
    status: "PROPOSED",
    acceptedSheetNumber: null,
    acceptedTitle: null,
    ...over,
  } as SheetRow["proposal"];
}

describe("disciplineOf", () => {
  it("prefers what ingest read over what the number spells", () => {
    // The title-block pass has READ the sheet; the prefix has only guessed.
    const sheet = row({
      pageNumber: 1,
      proposal: proposal({ sheetNumber: "H-96037", discipline: "A" }),
    });
    expect(disciplineOf(sheet)).toBe("A");
  });

  it("takes the whole letter run before a digit, not the first letter", () => {
    // `SP` must not collapse into `S`: a site plan is not a structural sheet.
    expect(disciplineOf(row({ pageNumber: 1, proposal: proposal({ sheetNumber: "SP-1" }) }))).toBe("SP");
    expect(disciplineOf(row({ pageNumber: 2, proposal: proposal({ sheetNumber: "S-101" }) }))).toBe("S");
  });

  it("reads a dotted number the same as a dashed one", () => {
    // Both are Eleven03's own spellings, on the same set.
    expect(disciplineOf(row({ pageNumber: 1, proposal: proposal({ sheetNumber: "A4.B.1" }) }))).toBe("A");
    expect(disciplineOf(row({ pageNumber: 2, proposal: proposal({ sheetNumber: "A-101" }) }))).toBe("A");
  });

  it("prefers the number a person accepted over the one proposed", () => {
    const sheet = row({
      pageNumber: 1,
      proposal: proposal({ sheetNumber: "E-101", acceptedSheetNumber: "M-101" }),
    });
    expect(disciplineOf(sheet)).toBe("M");
  });

  it("files a sheet with no readable number rather than guessing", () => {
    expect(disciplineOf(row({ pageNumber: 9, hasTextLayer: false }))).toBe(UNFILED);
    expect(disciplineOf(row({ pageNumber: 9, proposal: proposal({ sheetNumber: "   " }) }))).toBe(UNFILED);
  });

  it("keeps an unrecognised letter as its own heading", () => {
    // Findable under its own letter beats swept into a bucket called Other.
    // `K` is deliberately a letter the standard does NOT define — an earlier
    // version of this test used `W`, which it does (distributed energy), so
    // the test was asserting the recognised path while claiming the opposite.
    expect(disciplineName("K")).toBe("K");
    expect(disciplineName("A")).toBe("Architectural");
    expect(disciplineName(UNFILED)).toBe("Not filed");
  });
});

describe("scaleStatusOf", () => {
  const printed = { 2: '1/8" = 1\'-0"', 3: null };

  it("calls a calibrated sheet set, even when a printed scale disagrees", () => {
    // The calibration is a PERSON's answer and the only thing measurements are
    // computed against. A printed scale never overrides one.
    expect(scaleStatusOf(2, new Set([2]), printed)).toBe("set");
  });

  it("separates a sheet one click away from one that needs real work", () => {
    expect(scaleStatusOf(2, new Set(), printed)).toBe("confirm");
    expect(scaleStatusOf(3, new Set(), printed)).toBe("missing");
    expect(scaleStatusOf(99, new Set(), printed)).toBe("missing");
  });
});

describe("buildSheetTree", () => {
  const rows = [
    row({ pageNumber: 1, proposal: proposal({ sheetNumber: "G-001", title: "Cover" }) }),
    row({ pageNumber: 2, proposal: proposal({ sheetNumber: "A-101", title: "Floor plan" }) }),
    row({ pageNumber: 3, proposal: proposal({ sheetNumber: "A-102", title: "Enlarged plans" }) }),
    row({ pageNumber: 4, proposal: proposal({ sheetNumber: "S-101", title: "Foundation" }) }),
    row({ pageNumber: 5, hasTextLayer: false }),
  ];
  const base = {
    rows,
    calibratedPages: new Set([2]),
    printedScaleByPage: { 3: '1/4" = 1\'-0"' },
    measurementCountByPage: { 2: 7 },
    bookmarks: new Set([4]),
  };

  it("groups in the standard's order, not alphabetically", () => {
    // STRUCTURAL BEFORE ARCHITECTURAL, which is the National CAD Standard's
    // own order and looks wrong. This expectation was first written as G-A-S
    // from habit and the code failed it — the code was right. Left here as the
    // record of that, because the next person will reach for the same "fix".
    expect(buildSheetTree(base).map((group) => group.key)).toEqual(["G", "S", "A", UNFILED]);
  });

  it("carries the status, counts and bookmarks onto each sheet", () => {
    const architectural = buildSheetTree(base).find((group) => group.key === "A");
    expect(architectural?.sheets.map((sheet) => [sheet.pageNumber, sheet.scaleStatus, sheet.itemCount])).toEqual([
      [2, "set", 7],
      [3, "confirm", 0],
    ]);
    const structural = buildSheetTree(base).find((group) => group.key === "S");
    expect(structural?.sheets[0].bookmarked).toBe(true);
  });

  it("drops the headings a search empties", () => {
    // Sixteen disciplines with one sheet under one of them is a worse answer
    // than one heading.
    const found = buildSheetTree({ ...base, search: "foundation" });
    expect(found.map((group) => group.key)).toEqual(["S"]);
    expect(found[0].sheets).toHaveLength(1);
  });

  it("searches the number and the title, case-insensitively", () => {
    expect(buildSheetTree({ ...base, search: "a-10" })[0].sheets).toHaveLength(2);
    expect(buildSheetTree({ ...base, search: "COVER" })[0].sheets).toHaveLength(1);
  });

  it("matches a page number as a whole word, never as a substring", () => {
    // THE CASE THIS RULE EXISTS FOR. On a set whose title blocks did not read,
    // the page number is the only handle anybody has — and typing 2 must not
    // also return 12, 20 and 200, which `String(n).includes` would.
    const many = [2, 12, 20, 200].map((pageNumber) => row({ pageNumber, hasTextLayer: false }));
    const found = buildSheetTree({ ...base, rows: many, search: "2" });
    expect(found.flatMap((group) => group.sheets).map((sheet) => sheet.pageNumber)).toEqual([2]);
  });

  it("narrows to the sheets somebody has actually touched", () => {
    const mine = buildSheetTree({ ...base, onlyMine: true });
    // 4 before 2 because S precedes A — see the ordering test above.
    expect(mine.flatMap((group) => group.sheets).map((sheet) => sheet.pageNumber)).toEqual([4, 2]);
  });

  it("orders within a group by page, so unnumbered sheets still have a place", () => {
    const shuffled = [
      row({ pageNumber: 9, proposal: proposal({ sheetNumber: "A-900" }) }),
      row({ pageNumber: 2, proposal: proposal({ sheetNumber: "A-101" }) }),
    ];
    const tree = buildSheetTree({ ...base, rows: shuffled, measurementCountByPage: {}, bookmarks: new Set() });
    expect(tree[0].sheets.map((sheet) => sheet.pageNumber)).toEqual([2, 9]);
  });
});

describe("takeoffProgress", () => {
  it("counts a sheet as started only when something has been measured on it", () => {
    // A calibrated sheet nobody has traced is work SET UP, not work finished.
    // Counting it would read 100% before anything had been taken off.
    const tree = buildSheetTree({
      rows: [
        row({ pageNumber: 1, proposal: proposal({ sheetNumber: "A-101" }) }),
        row({ pageNumber: 2, proposal: proposal({ sheetNumber: "A-102" }) }),
      ],
      calibratedPages: new Set([1, 2]),
      printedScaleByPage: {},
      measurementCountByPage: { 1: 3 },
      bookmarks: new Set(),
    });
    expect(takeoffProgress(tree)).toEqual({ sheets: 2, started: 1, scaled: 2, needScale: 0, plansToScale: 0 });
  });
});

describe("looksLikeFloorPlan — the sheets to scale", () => {
  it("is an A-sheet whose title says plan and not a plan of something else; an untitled A-1xx counts", () => {
    expect(looksLikeFloorPlan("A101", "FLOOR PLAN", "A")).toBe(true);
    expect(looksLikeFloorPlan("A102", "SECOND FLOOR PLAN", "A")).toBe(true);
    expect(looksLikeFloorPlan("A111", "REFLECTED CEILING PLAN", "A")).toBe(false);
    expect(looksLikeFloorPlan("A201", "ROOF PLAN", "A")).toBe(false);
    expect(looksLikeFloorPlan("S2.0", "FOUNDATION PLAN", "S")).toBe(false);
    expect(looksLikeFloorPlan("A601", "WALL TYPES", "A")).toBe(false);
    expect(looksLikeFloorPlan("A101", null, "A")).toBe(true);
    expect(looksLikeFloorPlan("A601", null, "A")).toBe(false);
  });
});

describe("the sheets to scale come first in their group", () => {
  it("puts an unscaled floor plan ahead of earlier pages, and a scaled one back in page order", () => {
    const row = (pageNumber: number, sheetNumber: string, title: string): SheetRow => ({
      pageNumber,
      hasTextLayer: true,
      proposal: { id: `p${pageNumber}`, sheetNumber, title, discipline: null, pageType: null, scale: null, revision: null, issueDate: null, reason: "", confidence: "HIGH", status: "PROPOSED", acceptedSheetNumber: null, acceptedTitle: null },
    });
    const groups = buildSheetTree({
      rows: [row(1, "A001", "GENERAL NOTES"), row(2, "A101", "FLOOR PLAN"), row(3, "A111", "REFLECTED CEILING PLAN"), row(4, "A102", "SECOND FLOOR PLAN")],
      calibratedPages: new Set([4]),
      printedScaleByPage: { 2: "1/8\" = 1'-0\"" },
      measurementCountByPage: {},
      bookmarks: new Set(),
      rankPlans: true,
    });
    expect(groups[0].sheets.map((s) => s.pageNumber)).toEqual([2, 1, 3, 4]);
    expect(groups[0].sheets[0].scaleStatus).toBe("confirm");
    expect(takeoffProgress(groups).plansToScale).toBe(1);
    // And the group that holds it rises above the ones that do not.
    const withGeneral = buildSheetTree({
      rows: [row(5, "G001", "PROJECT INFORMATION"), row(6, "S2.0", "FOUNDATION PLAN"), row(2, "A101", "FLOOR PLAN")],
      calibratedPages: new Set(),
      printedScaleByPage: {},
      measurementCountByPage: {},
      bookmarks: new Set(),
      rankPlans: true,
    });
    expect(withGeneral.map((g) => g.key)).toEqual(["A", "G", "S"]);
    const pageOrder = buildSheetTree({
      rows: [row(5, "G001", "PROJECT INFORMATION"), row(6, "S2.0", "FOUNDATION PLAN"), row(2, "A101", "FLOOR PLAN")],
      calibratedPages: new Set(),
      printedScaleByPage: {},
      measurementCountByPage: {},
      bookmarks: new Set(),
    });
    expect(pageOrder.map((g) => g.key)).toEqual(["G", "S", "A"]);
  });

  it("keeps page order when the ranking is off, and offers each printed scale once with its unscaled sheets", () => {
    const row = (pageNumber: number, sheetNumber: string, title: string): SheetRow => ({
      pageNumber,
      hasTextLayer: true,
      proposal: { id: `p${pageNumber}`, sheetNumber, title, discipline: null, pageType: null, scale: null, revision: null, issueDate: null, reason: "", confidence: "HIGH", status: "PROPOSED", acceptedSheetNumber: null, acceptedTitle: null },
    });
    const groups = buildSheetTree({
      rows: [row(1, "A001", "GENERAL NOTES"), row(2, "A101", "FLOOR PLAN"), row(3, "A111", "REFLECTED CEILING PLAN"), row(4, "A102", "SECOND FLOOR PLAN")],
      calibratedPages: new Set([4]),
      printedScaleByPage: { 2: "1/8\" = 1'-0\"", 3: "1/8\" = 1'-0\"", 4: "1/8\" = 1'-0\"", 1: "1/4\" = 1'-0\"" },
      measurementCountByPage: {},
      bookmarks: new Set(),
    });
    expect(groups[0].sheets.map((s) => s.pageNumber)).toEqual([1, 2, 3, 4]);
    // Page 4 already has its scale, so it is not offered; the bigger group leads.
    expect(printedScaleOffers(groups)).toEqual([
      { scale: "1/8\" = 1'-0\"", pages: [2, 3] },
      { scale: "1/4\" = 1'-0\"", pages: [1] },
    ]);
  });
});
