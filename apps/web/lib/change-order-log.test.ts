import { describe, expect, it } from "vitest";
import { changeOrderLog, changeOrderLogFileName, changeOrderLogRows, type ChangeOrderForLog } from "./change-order-log";
import { sheetCsv } from "./sheet-export";

const co = (number: number, status: ChangeOrderForLog["status"], amount: number, submittedOn: string | null = "2026-10-01", over: Partial<ChangeOrderForLog> = {}): ChangeOrderForLog => ({
  number, title: `CO ${number}`, status, submittedOn, decidedOn: null, amount, revises: null, ...over,
});

const TODAY = "2026-11-03";
const log = changeOrderLog(
  [
    co(3, "SUBMITTED", 1000, "2026-10-20"),
    co(1, "APPROVED", 5000, "2026-09-01", { decidedOn: "2026-09-10" }),
    co(2, "REJECTED", 2500),
    co(4, "SUBMITTED", 700, "2026-09-25"),
    co(5, "SUBMITTED", -300, "2026-08-01"),
    co(6, "DRAFT", 9999, null),
    co(7, "VOID", 400, "2026-10-02", { revises: 3 }),
  ],
  TODAY,
);

describe("the log", () => {
  it("lists what went to the GC in number order, and counts drafts without listing them", () => {
    expect(log.rows.map((row) => row.number)).toEqual([1, 2, 3, 4, 5, 7]);
    expect(log.drafts).toBe(1);
  });

  it("counts days pending only for a change order still with the GC", () => {
    expect(log.rows.map((row) => [row.number, row.daysPending])).toEqual([[1, null], [2, null], [3, 14], [4, 39], [5, 94], [7, null]]);
  });

  it("totals executed, pending and rejected, and leaves a withdrawn one out of all three", () => {
    expect(log.totals).toEqual({
      approved: { count: 1, amount: 5000 },
      pending: { count: 3, amount: 1400 },
      rejected: { count: 1, amount: 2500 },
    });
  });

  it("ages the pending ones at 30 and 60 days, both ends counted once", () => {
    expect(log.aging.map((band) => [band.label, band.count, band.amount])).toEqual([
      ["0–30 days", 1, 1000],
      ["31–60 days", 1, 700],
      ["Over 60 days", 1, -300],
    ]);
    const edges = changeOrderLog([co(1, "SUBMITTED", 1, "2026-10-04"), co(2, "SUBMITTED", 1, "2026-10-03"), co(3, "SUBMITTED", 1, "2026-09-04"), co(4, "SUBMITTED", 1, "2026-09-03")], TODAY);
    expect(edges.rows.map((row) => row.daysPending)).toEqual([30, 31, 60, 61]);
    expect(edges.aging.map((band) => band.count)).toEqual([1, 2, 1]);
  });

  it("does not count a change order dated after today as negative days", () => {
    expect(changeOrderLog([co(1, "SUBMITTED", 1, "2026-11-10")], TODAY).rows[0].daysPending).toBe(0);
  });
});

describe("the file", () => {
  const rows = changeOrderLogRows(log, { jobName: "Tower, Phase 2", asOf: TODAY });

  it("keeps a credit a number and names a revision", () => {
    const csv = sheetCsv(rows);
    expect(csv).toContain("5,CO 5,Pending GC,2026-08-01,,94,-300,");
    expect(csv).toContain(",CO 3\r\n");
    expect(csv).toContain('"Tower, Phase 2"');
  });

  it("puts the totals and aging under the rows", () => {
    expect(rows.slice(-8)).toEqual([
      ["Executed", 1, 5000],
      ["Pending GC", 3, 1400],
      ["Rejected", 1, 2500],
      [],
      ["Pending, by age"],
      ["0–30 days", 1, 1000],
      ["31–60 days", 1, 700],
      ["Over 60 days", 1, -300],
    ]);
  });

  it("stops a title running as a formula", () => {
    const formula = changeOrderLogRows(changeOrderLog([co(1, "APPROVED", 1, "2026-10-01", { title: "=HYPERLINK(1)" })], TODAY), { jobName: "J", asOf: TODAY });
    expect(sheetCsv(formula)).toContain("'=HYPERLINK(1)");
  });

  it("names the file for the job and day", () => {
    expect(changeOrderLogFileName("Tower/North", TODAY, "xlsx")).toBe("Change order log Tower-North 2026-11-03.xlsx");
  });
});
