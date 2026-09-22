import { describe, expect, it } from "vitest";
import { formatHours, formatHoursOrNull } from "./render-hours";

/**
 * The arithmetic itself. `hoursRenderCensus.test.ts` is the other half —
 * it makes sure every screen actually calls this.
 */
describe("formatHours", () => {
  it("prints the reported week without the float tail", () => {
    // THE BUG, exactly as the pilot contractor logged it: five days on a
    // certified payroll, and JavaScript's answer is 35.300000000000004.
    const week = [7.0, 7.0, 7.0, 7.1, 7.2];
    const total = week.reduce((sum, day) => sum + day, 0);
    expect(total).not.toBe(35.3); // the sum really is wrong, not the render
    expect(formatHours(total)).toBe("35.3");
  });

  it("drops trailing zeroes — hours are a quantity, not money", () => {
    expect(formatHours(8)).toBe("8");
    expect(formatHours(8.0)).toBe("8");
    expect(formatHours(16.5)).toBe("16.5");
    expect(formatHours(0)).toBe("0");
  });

  it("keeps both decimal places the column can hold", () => {
    // TimeEntry.hours is Decimal(5,2), so .25 is a value somebody entered
    // and must survive. Rounding to the column's own precision can only
    // remove digits the SUM invented.
    expect(formatHours(7.25)).toBe("7.25");
    expect(formatHours(0.1 + 0.2)).toBe("0.3");
    expect(formatHours(99.99)).toBe("99.99");
  });

  it("holds for the accumulations these screens actually build", () => {
    // Per-pay-type buckets, a day roll-up and a week total are all `+=`
    // loops over Decimal(5,2) values. Each of these sums is wrong in raw
    // JavaScript; none of them may print wrong.
    expect(formatHours([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].reduce((a, b) => a + b, 0))).toBe("2.8");
    expect(formatHours(8 + 8 + 8 + 8 + 8.1)).toBe("40.1");
    expect(formatHours(1.005 + 2.005)).toBe("3.01");
  });
});

describe("formatHoursOrNull", () => {
  it("renders the caller's own empty marker, never a stray zero", () => {
    // A WH-347 grid cell is BLANK for a day nobody worked; an on-screen
    // table uses an em dash. Printing "0" instead would be a statement
    // that zero hours were worked, which is a different claim.
    expect(formatHoursOrNull(null)).toBe("");
    expect(formatHoursOrNull(undefined)).toBe("");
    expect(formatHoursOrNull(null, "—")).toBe("—");
  });

  it("formats a present value exactly as formatHours does", () => {
    expect(formatHoursOrNull(7.0 + 7.0 + 7.0 + 7.1 + 7.2)).toBe("35.3");
    expect(formatHoursOrNull(0)).toBe("0"); // zero is a value, not an absence
  });
});
