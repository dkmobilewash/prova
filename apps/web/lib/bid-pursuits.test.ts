import { describe, expect, it } from "vitest";
import {
  comparePursuits,
  daysFromTo,
  isBidDateComingUp,
  isBidDatePassed,
  isGoneQuiet,
  isOpenPursuit,
  optionalDateFromString,
  optionalValueFromString,
  stageFromString,
  summarisePursuits,
  type PursuitForDerivation,
} from "./bid-pursuits";

const TODAY = "2026-09-18";

function pursuit(overrides: Partial<PursuitForDerivation> = {}): PursuitForDerivation {
  return { stage: "WATCHING", expectedBidDate: null, lastUpdated: TODAY, estimatedValue: null, ...overrides };
}

describe("which pursuits are still being chased", () => {
  it("counts the three pre-invite stages as open and INVITED / DROPPED as closed", () => {
    expect(isOpenPursuit("WATCHING")).toBe(true);
    expect(isOpenPursuit("CONTACTED")).toBe(true);
    expect(isOpenPursuit("EXPECTING_INVITE")).toBe(true);
    expect(isOpenPursuit("INVITED")).toBe(false);
    expect(isOpenPursuit("DROPPED")).toBe(false);
  });
});

describe("gone quiet — derived from the last edit, never stored", () => {
  it("is quiet at exactly 30 days untouched and not at 29", () => {
    expect(isGoneQuiet(pursuit({ lastUpdated: "2026-08-19" }), TODAY)).toBe(true); // 30 days
    expect(isGoneQuiet(pursuit({ lastUpdated: "2026-08-20" }), TODAY)).toBe(false); // 29 days
  });

  it("never calls a closed pursuit quiet — there is nothing left to chase", () => {
    expect(isGoneQuiet(pursuit({ stage: "DROPPED", lastUpdated: "2025-01-01" }), TODAY)).toBe(false);
    expect(isGoneQuiet(pursuit({ stage: "INVITED", lastUpdated: "2025-01-01" }), TODAY)).toBe(false);
  });
});

describe("expected bid dates", () => {
  it("is coming up from today through 30 days ahead, inclusive at both ends", () => {
    expect(isBidDateComingUp(pursuit({ expectedBidDate: TODAY }), TODAY)).toBe(true);
    expect(isBidDateComingUp(pursuit({ expectedBidDate: "2026-10-18" }), TODAY)).toBe(true); // +30
    expect(isBidDateComingUp(pursuit({ expectedBidDate: "2026-10-19" }), TODAY)).toBe(false); // +31
  });

  it("a date that has gone by is PASSED, not coming up", () => {
    const passed = pursuit({ expectedBidDate: "2026-09-17" });
    expect(isBidDateComingUp(passed, TODAY)).toBe(false);
    expect(isBidDatePassed(passed, TODAY)).toBe(true);
  });

  it("today is not passed — the bid may still be due today", () => {
    expect(isBidDatePassed(pursuit({ expectedBidDate: TODAY }), TODAY)).toBe(false);
  });

  it("an undated pursuit is neither coming up nor passed", () => {
    expect(isBidDateComingUp(pursuit(), TODAY)).toBe(false);
    expect(isBidDatePassed(pursuit(), TODAY)).toBe(false);
  });

  it("an invited or dropped pursuit never flags its date — the invite came, or we stopped", () => {
    for (const stage of ["INVITED", "DROPPED"] as const) {
      expect(isBidDatePassed(pursuit({ stage, expectedBidDate: "2026-01-01" }), TODAY)).toBe(false);
      expect(isBidDateComingUp(pursuit({ stage, expectedBidDate: "2026-09-20" }), TODAY)).toBe(false);
    }
  });
});

describe("summary counts", () => {
  const rows = [
    pursuit({ stage: "WATCHING", estimatedValue: 100_000, expectedBidDate: "2026-09-25" }),
    pursuit({ stage: "CONTACTED", estimatedValue: null, lastUpdated: "2026-07-01" }),
    pursuit({ stage: "EXPECTING_INVITE", estimatedValue: 50_000.5, expectedBidDate: "2026-09-01" }),
    pursuit({ stage: "INVITED", estimatedValue: 999_999 }),
    pursuit({ stage: "DROPPED", estimatedValue: 777 }),
  ];

  it("counts by stage and splits open from closed", () => {
    const summary = summarisePursuits(rows, TODAY);
    expect(summary.total).toBe(5);
    expect(summary.open).toBe(3);
    expect(summary.byStage).toEqual({ WATCHING: 1, CONTACTED: 1, EXPECTING_INVITE: 1, INVITED: 1, DROPPED: 1 });
    expect(summary.bidDatesComingUp).toBe(1);
    expect(summary.bidDatesPassed).toBe(1);
    expect(summary.goneQuiet).toBe(1);
  });

  it("sums value over OPEN pursuits only, and says how many open ones had none", () => {
    const summary = summarisePursuits(rows, TODAY);
    // Not the invited 999,999 nor the dropped 777: those are not being chased.
    expect(summary.openEstimatedValue).toBeCloseTo(150_000.5, 2);
    expect(summary.openUnpriced).toBe(1);
  });
});

describe("the order the list is worked in", () => {
  it("puts open before closed, soonest bid date first, undated after dated", () => {
    const rows = [
      { name: "dropped", p: pursuit({ stage: "DROPPED", expectedBidDate: "2026-01-01" }) },
      { name: "undated", p: pursuit() },
      { name: "later", p: pursuit({ expectedBidDate: "2026-12-01" }) },
      { name: "passed", p: pursuit({ expectedBidDate: "2026-09-01" }) },
    ];
    const sorted = [...rows].sort((a, b) => comparePursuits(a.p, b.p)).map((r) => r.name);
    expect(sorted).toEqual(["passed", "later", "undated", "dropped"]);
  });
});

describe("parsing what somebody typed", () => {
  it("reads a date as a UTC-midnight calendar day and a blank as null", () => {
    expect(optionalDateFromString("2026-10-01")?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(optionalDateFromString("  ")).toBeNull();
    expect(() => optionalDateFromString("10/01/2026")).toThrow("not valid");
  });

  it("forgives $ and commas in a value, refuses a negative or a word", () => {
    expect(optionalValueFromString("$250,000.50")).toBe("250000.50");
    expect(optionalValueFromString("")).toBeNull();
    expect(() => optionalValueFromString("-5")).toThrow();
    expect(() => optionalValueFromString("lots")).toThrow();
    // DECIMAL(12,2) holds ten digits before the point; eleven is refused in
    // words rather than left to fail in the database.
    expect(() => optionalValueFromString("12345678901")).toThrow();
  });

  it("accepts only the five stages", () => {
    expect(stageFromString("EXPECTING_INVITE")).toBe("EXPECTING_INVITE");
    expect(() => stageFromString("WON")).toThrow("Pick a stage");
  });

  it("counts whole calendar days", () => {
    expect(daysFromTo("2026-09-01", "2026-09-18")).toBe(17);
    expect(daysFromTo("2026-09-18", "2026-09-01")).toBe(-17);
  });
});
