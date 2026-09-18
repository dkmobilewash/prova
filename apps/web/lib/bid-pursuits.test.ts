import { describe, expect, it } from "vitest";
import {
  comparePursuits,
  daysFromTo,
  describeOpenPursuitValue,
  isBidDateComingUp,
  isBidDatePassed,
  isGoneQuiet,
  isOpenPursuit,
  openPursuitValue,
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
    expect(summary.openEstimatedValue).toBe(150_000.5);
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

describe("the open value is money, summed as money", () => {
  it("adds $100.10 and $200.20 to exactly 300.30, not 300.29999999999995", () => {
    // Float addition of the two gives 300.29999999999995, which the Ask tool
    // handed the model raw. Summed in whole cents, it is 300.3 on the nose.
    const summary = summarisePursuits(
      [pursuit({ estimatedValue: 100.1 }), pursuit({ estimatedValue: 200.2 })],
      TODAY,
    );
    expect(100.1 + 200.2).not.toBe(300.3); // the trap is real on this runtime
    expect(summary.openEstimatedValue).toBe(300.3);
    expect(summary.openEstimatedValue.toFixed(2)).toBe("300.30");
  });

  it("stays exact across many cent amounts", () => {
    const rows = Array.from({ length: 10 }, () => pursuit({ estimatedValue: 0.1 }));
    expect(summarisePursuits(rows, TODAY).openEstimatedValue).toBe(1);
  });
});

describe("the value parser reads money the way a person types it", () => {
  it("forgives a space after the dollar sign", () => {
    expect(optionalValueFromString("$ 250,000")).toBe("250000");
    expect(optionalValueFromString(" $250,000 ")).toBe("250000");
  });

  it("accepts commas only as thousands grouping", () => {
    expect(optionalValueFromString("1,250,000.00")).toBe("1250000.00");
    expect(optionalValueFromString("1250000")).toBe("1250000");
    // "1,2,3" is not a number anybody meant; storing 123 is worse than asking.
    expect(() => optionalValueFromString("1,2,3")).toThrow();
    expect(() => optionalValueFromString("12,50")).toThrow();
    expect(() => optionalValueFromString("1,0000")).toThrow();
    expect(() => optionalValueFromString(",250")).toThrow();
  });

  it("refuses zero, because blank — not zero — means nobody said", () => {
    expect(() => optionalValueFromString("0")).toThrow(/leave it blank/);
    expect(() => optionalValueFromString("$0.00")).toThrow(/leave it blank/);
    expect(optionalValueFromString("0.50")).toBe("0.50");
  });
});

describe("the open total /pipeline shows — one sum, shared with the Ask tool", () => {
  const rows = [
    pursuit({ stage: "WATCHING", estimatedValue: 250_000 }),
    pursuit({ stage: "CONTACTED", estimatedValue: 100_000.5 }),
    pursuit({ stage: "EXPECTING_INVITE", estimatedValue: null }),
    // Closed: none of these is being chased, so none of it is in the total.
    pursuit({ stage: "INVITED", estimatedValue: 5_000_000 }),
    pursuit({ stage: "DROPPED", estimatedValue: 1_234.56 }),
    pursuit({ stage: "DROPPED", estimatedValue: null }),
  ];

  it("adds open pursuits only, in cents, and counts the blank one instead of calling it $0", () => {
    expect(openPursuitValue(rows)).toEqual({ open: 3, priced: 2, unpriced: 1, total: 350_000.5 });
  });

  it("says it in plain words, naming the pursuit with no value", () => {
    expect(describeOpenPursuitValue(openPursuitValue(rows))).toBe(
      "3 open, 2 with a value, about $350,000.50 — 1 has no value yet",
    );
  });

  it("is exactly what the Ask tool's summary reports, not a second sum", () => {
    const summary = summarisePursuits(rows, TODAY);
    const value = openPursuitValue(rows);
    expect(summary.openEstimatedValue).toBe(value.total);
    expect(summary.openUnpriced).toBe(value.unpriced);
    expect(summary.open).toBe(value.open);
  });

  it("stays in cents where float addition would not", () => {
    // 100.10 + 200.20 as floats is 300.29999999999995, which money() would
    // still round to $300.30 — so the exact total is asserted, not the text.
    const value = openPursuitValue([pursuit({ estimatedValue: 100.1 }), pursuit({ estimatedValue: 200.2 })]);
    expect(value.total).toBe(300.3);
  });

  it("rounds each value to a whole cent BEFORE adding", () => {
    // 0.29 * 100 is 28.999999999999996: converting to cents without rounding
    // each one still drifts (0.8599999999999999), so the round is load-bearing.
    const value = openPursuitValue([pursuit({ estimatedValue: 0.29 }), pursuit({ estimatedValue: 0.57 })]);
    expect(value.total).toBe(0.86);
  });

  it("drops the 'with a value' clause when every open pursuit has one", () => {
    const value = openPursuitValue([pursuit({ estimatedValue: 250_000 }), pursuit({ estimatedValue: 100_000.5 })]);
    expect(describeOpenPursuitValue(value)).toBe("2 open, about $350,000.50");
  });

  it("does not print $0.00 when nothing open has a value", () => {
    const value = openPursuitValue([pursuit(), pursuit(), pursuit({ stage: "INVITED", estimatedValue: 9 })]);
    expect(value).toEqual({ open: 2, priced: 0, unpriced: 2, total: 0 });
    expect(describeOpenPursuitValue(value)).toBe("2 open, none with a value yet");
  });

  it("says nothing when nothing is open — there is no total to state", () => {
    expect(describeOpenPursuitValue(openPursuitValue([]))).toBeNull();
    expect(describeOpenPursuitValue(openPursuitValue([pursuit({ stage: "DROPPED", estimatedValue: 500 })]))).toBeNull();
  });

  it("agrees the verb with the count of unpriced pursuits", () => {
    const value = openPursuitValue([pursuit({ estimatedValue: 10 }), pursuit(), pursuit()]);
    expect(describeOpenPursuitValue(value)).toBe("3 open, 1 with a value, about $10.00 — 2 have no value yet");
  });
});
