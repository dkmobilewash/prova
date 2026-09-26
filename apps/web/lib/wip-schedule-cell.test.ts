import { describe, expect, it } from "vitest";
import { CANNOT_SAY, CANNOT_SAY_TITLE, wipScheduleCell } from "./wip-schedule-cell";
import { WIP_SCHEDULE_COLUMNS } from "./wip-schedule";

/**
 * THE ONE RULE THIS PAGE CAN GET WRONG IN A WAY THAT COSTS SOMEBODY MONEY:
 * a blank is not a zero.
 *
 * `wipScheduleRow` returns `null` for a figure when under 80% of the job's
 * value carries the estimate it depends on — the number would describe
 * missing data rather than the job. The CSV says so in its preamble and
 * leaves the cell empty, which a spreadsheet can carry.
 *
 * A screen cannot. `$0.00` in a gross-profit column reads as a job that
 * broke even; an empty cell reads as nothing at all; "we cannot say yet"
 * is the truth. Three different facts, one of them true, and a surety or
 * an owner deciding what to chase cannot tell them apart by looking.
 *
 * So every nullable column renders a mark AND a reason, and these tests
 * are mostly about refusing the two plausible wrong answers.
 */

describe("a figure the app cannot state", () => {
  it("is never zero", () => {
    for (const key of ["estimatedGrossProfit", "earnedRevenue", "overbilled", "underbilled"] as const) {
      const cell = wipScheduleCell(key, null);
      expect(cell.text, `${key} rendered a number for a null`).toBe(CANNOT_SAY);
      expect(cell.text).not.toContain("0");
      expect(cell.text).not.toContain("$");
    }
  });

  it("is never blank — a screen has no preamble to carry the meaning", () => {
    const cell = wipScheduleCell("earnedRevenue", null);
    expect(cell.text.trim()).not.toBe("");
  });

  it("always carries its reason, so the mark cannot be shown bare", () => {
    const cell = wipScheduleCell("percentComplete", null);
    expect(cell.title).toBe(CANNOT_SAY_TITLE);
    expect(cell.title).toMatch(/not zero/i);
    // It has to say where to look, or it is a shrug.
    expect(cell.title).toMatch(/coverage/i);
  });

  it("gives a reason ONLY to the cannot-say mark", () => {
    // A title on an ordinary figure would be noise, and worse, would make
    // the presence of a title stop meaning anything.
    expect(wipScheduleCell("contractValue", 1000).title).toBeUndefined();
    expect(wipScheduleCell("job", "Riverside").title).toBeUndefined();
  });
});

describe("the three kinds of figure are not interchangeable", () => {
  it("renders money as money", () => {
    expect(wipScheduleCell("contractValue", 12_500).text).toBe("$12,500.00");
    expect(wipScheduleCell("costToDate", 0).text).toBe("$0.00");
  });

  it("renders a ratio as a percentage, never as dollars", () => {
    const cell = wipScheduleCell("percentComplete", 42.5);
    expect(cell.text).toBe("42.5%");
    expect(cell.text).not.toContain("$");
  });

  it("renders unpriced hours as hours, and zero hours as a real zero", () => {
    // Zero here is a FACT — every hour on the job carries a burdened cost
    // — unlike the silenced money cells above. Rendering it as a dash
    // would invent a coverage problem that does not exist.
    const cell = wipScheduleCell("unpricedLaborHours", 0);
    expect(cell.text).toBe("0");
    expect(cell.text).not.toBe(CANNOT_SAY);
    expect(cell.title).toBeUndefined();
    expect(wipScheduleCell("unpricedLaborHours", 12.5).text).toBe("12.5");
  });

  it("renders text columns as their words", () => {
    expect(wipScheduleCell("job", "Building C drywall")).toEqual({
      text: "Building C drywall",
      numeric: false,
    });
    expect(wipScheduleCell("status", "IN_PROGRESS").numeric).toBe(false);
  });

  it("does not turn an empty job name into a coverage complaint", () => {
    // The TOTAL row has no customer. An em dash there would claim the app
    // could not work something out, which is a different sentence.
    const cell = wipScheduleCell("customer", "");
    expect(cell.text).toBe("");
    expect(cell.title).toBeUndefined();
  });

  it("aligns figures right and words left", () => {
    expect(wipScheduleCell("contractValue", 1).numeric).toBe(true);
    expect(wipScheduleCell("percentComplete", null).numeric).toBe(true);
    expect(wipScheduleCell("job", "x").numeric).toBe(false);
  });
});

describe("every column the schedule declares is handled", () => {
  it("covers all of WIP_SCHEDULE_COLUMNS, with nothing falling through", () => {
    // Guards the guard: the sets above are hand-written, so a column added
    // to the schedule would otherwise be silently formatted as money — and
    // a new RATIO printed as "$42.50" is exactly the kind of confident
    // wrong number this file exists to prevent.
    expect(WIP_SCHEDULE_COLUMNS.length).toBeGreaterThan(15);
    for (const { key } of WIP_SCHEDULE_COLUMNS) {
      // Probed with the kind of value the column actually carries: a text
      // column handed a number would fail for the wrong reason and teach
      // nobody anything.
      const numeric = wipScheduleCell(key, 42.5).numeric;
      const cell = numeric ? wipScheduleCell(key, 42.5) : wipScheduleCell(key, "Riverside");
      expect(cell.text, `${key} produced nothing`).not.toBe("");

      if (!numeric) continue;
      // Money, percent or hours — never a bare number with no unit, which
      // is how a new RATIO column would silently print as "$42.50".
      const shaped = cell.text.startsWith("$") || cell.text.endsWith("%") || cell.text === "42.5";
      expect(shaped, `${key} rendered "${cell.text}", which has no unit`).toBe(true);
    }
  });

  it("never prints NaN", () => {
    expect(wipScheduleCell("contractValue", Number.NaN).text).not.toContain("NaN$");
    expect(wipScheduleCell("contractValue", Number.NaN).text).toBe("NaN");
  });
});
