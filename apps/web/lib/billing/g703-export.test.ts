import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { calculatePayAppLineItem, calculatePayAppSummary } from "@/lib/pay-application";
import { monthEnd } from "@/lib/month-end";
import { g702Document, party } from "./g702";
import { G703_COLUMNS, g703Csv, g703FileName, g703Rows, g703Workbook } from "./g703-export";

const line = (description: string, scheduledValue: number, previousBilled: number, thisPeriodBilled: number, materialsStoredValue = 0) =>
  calculatePayAppLineItem({ lineItemId: description, description, scheduledValue, previousBilled, thisPeriodBilled, previousMaterialsStored: 0, materialsStoredValue });

const doc = (lines = [line("Framing labor", 60000, 20000, 15000), line("5/8 type X board", 15000, 3000, 3000, 1000), line("=1+1", 25000, 5000, -500)]) =>
  g702Document({
    header: {
      project: "Tower, Phase 2",
      projectLocation: null,
      to: party("GC"),
      from: party("Acme"),
      contractFor: null,
      applicationNumber: 2,
      applicationDate: "Oct 30, 2026",
      periodTo: "Oct 31, 2026",
      contractDate: null,
      projectNumber: "P-9",
    },
    lineItems: lines,
    summary: calculatePayAppSummary({ lineItems: lines, previousRetainageWithheld: 0, thisPeriodRetainageWithheld: 0 }),
    netChangeByChangeOrders: 0,
  });

describe("the rows", () => {
  const rows = g703Rows(doc());
  const header = rows.findIndex((row) => row[0] === G703_COLUMNS[0]);

  it("carries the job, application and period above the columns", () => {
    expect(rows.slice(0, 5)).toEqual([
      ["Project", "Tower, Phase 2"],
      ["Project no.", "P-9"],
      ["Application no.", 2],
      ["Application date", "Oct 30, 2026"],
      ["Period to", "Oct 31, 2026"],
    ]);
  });

  it("gives every column from A to I, with I blank as on the sheet", () => {
    expect(rows[header]).toHaveLength(10);
    expect(rows[header + 1]).toEqual([1, "Framing labor", 60000, 20000, 15000, 0, 35000, 58.3, 25000, null]);
  });

  it("uses the document's own figures, line for line, and its grand totals", () => {
    const made = doc();
    made.continuation.rows.forEach((row, index) => {
      const cells = rows[header + 1 + index];
      expect(cells.slice(2, 7)).toEqual([row.scheduledValue, row.fromPrevious, row.thisPeriod, row.materialsStored, row.totalCompletedAndStored]);
      expect(cells[8]).toBe(row.balanceToFinish);
    });
    const totals = rows[rows.length - 1];
    expect(totals[1]).toBe("Grand totals");
    expect(totals.slice(2, 7)).toEqual([100000, 28000, 17500, 1000, 46500]);
  });
});

describe("the CSV", () => {
  const csv = g703Csv(doc());

  it("keeps a negative correction a number", () => {
    expect(csv).toContain(",-500,");
    expect(csv).not.toContain("'-500");
  });

  it("stops a description running as a formula, and quotes a comma", () => {
    expect(csv).toContain("'=1+1");
    expect(csv).toContain('"Tower, Phase 2"');
  });

  it("names the file for the job and application", () => {
    expect(g703FileName(doc(), "csv")).toBe("G703 Tower, Phase 2 application 2.csv");
    expect(g703FileName(doc(), "xlsx")).toBe("G703 Tower, Phase 2 application 2.xlsx");
  });
});

describe("the Excel file", () => {
  const sheet = XLSX.read(g703Workbook(doc()), { type: "buffer" }).Sheets.G703;

  it("reads back with real numbers", () => {
    expect(sheet.C8).toMatchObject({ t: "n", v: 60000 });
    expect(sheet.E10).toMatchObject({ t: "n", v: -500 });
  });

  it("holds a formula-looking description as text", () => {
    expect(sheet.B10).toMatchObject({ t: "s", v: "=1+1" });
    expect(sheet.B10.f).toBeUndefined();
  });
});

describe("the last day of a month", () => {
  it.each([
    ["2026-11-01", "2026-11-30"],
    ["2026-10-31", "2026-10-31"],
    ["2026-12-15", "2026-12-31"],
    ["2028-02-10", "2028-02-29"],
    ["2026-02-10", "2026-02-28"],
    ["", ""],
    ["soon", ""],
  ])("%s gives %s", (day, end) => expect(monthEnd(day)).toBe(end));
});
