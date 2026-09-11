import { describe, expect, it } from "vitest";
import { addDays, parseAmount, parseHours } from "./numbers";

describe("parseAmount", () => {
  it("accepts the ways people write a dollar figure and normalises them to one form", () => {
    for (const text of ["12500", "12,500", "$12,500", "$ 12,500.00", "12500.0", "USD 12500"]) {
      expect(parseAmount(text), text).toEqual({ value: "12500.00", cents: 1_250_000, display: "$12,500.00" });
    }
    expect(parseAmount("0.5")).toEqual({ value: "0.50", cents: 50, display: "$0.50" });
  });

  it("refuses anything that would need a guess", () => {
    for (const text of ["12.5k", "about 12500", "twelve grand", "12500.123", "-500", "0", "", undefined]) {
      expect(parseAmount(text), String(text)).toBeNull();
    }
  });
});

describe("parseHours", () => {
  it("accepts hours with or without a unit word", () => {
    expect(parseHours("8")).toEqual({ value: "8", display: "8 hours" });
    expect(parseHours("8 hours")).toEqual({ value: "8", display: "8 hours" });
    expect(parseHours("7.5h")).toEqual({ value: "7.5", display: "7.5 hours" });
    expect(parseHours("1 hr")).toEqual({ value: "1", display: "1 hour" });
  });

  it("refuses zero, more than a day, and anything that is not a number", () => {
    for (const text of ["0", "25", "eight", "8-10", "", undefined]) {
      expect(parseHours(text), String(text)).toBeNull();
    }
  });
});

describe("addDays", () => {
  it("moves a calendar day by whole days in UTC, across a month end", () => {
    expect(addDays("2026-09-09", 30)).toBe("2026-10-09");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-09-09", 0)).toBe("2026-09-09");
  });
});
