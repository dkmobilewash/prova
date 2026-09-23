import { describe, expect, it } from "vitest";
import {
  employerBurdenCents,
  employerBurdenEffectiveDate,
  employerBurdenPercentOn,
  employerBurdenPercentOnDay,
  employerBurdenPercentProblem,
  employerBurdenPercentText,
  employerBurdenStanding,
  laborCostBasisLabel,
  type EmployerBurdenRateRecord,
} from "./employer-burden";
import {
  calculateBurdenedLaborCost,
  lineItemCostToDate,
  unassignedLaborCost,
  NO_EMPLOYER_BURDEN,
  type TimeEntryCostRow,
} from "./labor-job-cost";
import type { FringeRateScheduleInput } from "./labor-cost";

/**
 * The employer burden — and above everything else, that recording NONE
 * changes NOTHING.
 *
 * The fixture is the one `labor-job-cost.test.ts` already uses, on purpose:
 * $45 base, $23/hr of fringes, $68/hr straight. Every expectation below is
 * arithmetic written out by hand rather than the code under test run twice.
 */
const JOURNEYMAN = "craft_jw";

const schedule = (over: Partial<FringeRateScheduleInput> = {}): FringeRateScheduleInput => ({
  baseWage: 45,
  pensionRate: 8,
  vacationRate: 3,
  healthWelfareRate: 11,
  trainingRate: 1,
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  effectiveTo: null,
  ...over,
});

const schedules = new Map<string, FringeRateScheduleInput[]>([[JOURNEYMAN, [schedule()]]]);

const entry = (over: Partial<TimeEntryCostRow> = {}): TimeEntryCostRow => ({
  lineItemId: "line_1",
  craftClassificationId: JOURNEYMAN,
  date: new Date("2026-03-02T00:00:00.000Z"),
  hours: 8,
  payType: "STRAIGHT",
  perDiemAmount: null,
  travelPayAmount: null,
  ...over,
});

const plain = (over: Partial<TimeEntryCostRow> = {}) => {
  const row = entry(over);
  return {
    craftClassificationId: row.craftClassificationId,
    date: row.date,
    hours: Number(row.hours),
    payType: row.payType,
    perDiemAmount: row.perDiemAmount == null ? null : Number(row.perDiemAmount),
    travelPayAmount: row.travelPayAmount == null ? null : Number(row.travelPayAmount),
  };
};

const rate = (effectiveDate: string, percent: string): EmployerBurdenRateRecord => ({
  id: `burden_${effectiveDate}`,
  effectiveDate,
  percent,
  note: null,
});

// ---------------------------------------------------------------------------
// THE CONSTRAINT THAT MATTERS MOST. These figures have already been quoted to
// GCs. A company that records no burden rate must get the same numbers it got
// yesterday -- not close, the same.
// ---------------------------------------------------------------------------
describe("with no rate recorded, nothing moves", () => {
  // Hand-computed from the fixture, not from the code:
  //   8h straight  = 8 x (45 + 23)          = 544
  //   4h overtime  = 4 x ((45 x 1.5) + 23)  = 362
  //   per diem 65 + travel 30               =  95
  const MIXED = [
    plain(),
    plain({ hours: 4, payType: "OVERTIME" }),
    plain({ perDiemAmount: 65, travelPayAmount: 30 }),
  ];

  it("prices a mixed day exactly as it did before employer burden existed", () => {
    const result = calculateBurdenedLaborCost(MIXED, schedules, NO_EMPLOYER_BURDEN);
    expect(result.wageCost).toBe(544 + 362 + 544);
    expect(result.burdenCost).toBe(0);
    expect(result.allowanceCost).toBe(95);
    expect(result.total).toBe(544 + 362 + 544 + 95);
  });

  it("gives the identical total whether burden is omitted, empty, or absent from the dates", () => {
    const omitted = calculateBurdenedLaborCost(MIXED, schedules);
    const empty = calculateBurdenedLaborCost(MIXED, schedules, []);
    // A rate that exists but has not started yet is still "no rate in force".
    const future = calculateBurdenedLaborCost(MIXED, schedules, [rate("2099-01-01", "15.000")]);

    expect(empty).toEqual(omitted);
    expect(future).toEqual(omitted);
    // Object.is rather than toBe alone, because the claim is about the exact
    // float and not about a value that rounds to the same display.
    expect(Object.is(future.total, omitted.total)).toBe(true);
    expect(future.burdenCost).toBe(0);
  });

  it("leaves lineItemCostToDate and unassignedLaborCost byte-identical", () => {
    const rows = [entry(), entry({ lineItemId: null, hours: 5 })];
    expect(lineItemCostToDate("line_1", [{ amount: 1200 }], rows, schedules, [])).toEqual(
      lineItemCostToDate("line_1", [{ amount: 1200 }], rows, schedules),
    );
    expect(unassignedLaborCost(rows, schedules, [])).toEqual(unassignedLaborCost(rows, schedules));
  });

  it("says so on screen: with no rate the basis reads 'wage and fringes'", () => {
    expect(laborCostBasisLabel(null)).toBe("wage and fringes");
    expect(laborCostBasisLabel(null)).not.toContain("burden");
  });
});

// ---------------------------------------------------------------------------
describe("the burden applies to the base wage and not to the fringes", () => {
  const FIFTEEN = [rate("2026-01-01", "15.000")];

  it("adds 15% of the base wage on a straight-time day", () => {
    const result = calculateBurdenedLaborCost([plain()], schedules, FIFTEEN);
    // base 8 x 45 = 360; 15% of 360 = 54. NOT 15% of 544 (81.60).
    expect(result.wageCost).toBe(544);
    expect(result.burdenCost).toBe(54);
    expect(result.total).toBe(598);
  });

  it("is not 15% of the wage-and-fringe figure", () => {
    const result = calculateBurdenedLaborCost([plain()], schedules, FIFTEEN);
    expect(result.burdenCost).not.toBeCloseTo(544 * 0.15, 6);
  });

  it("ignores a craft whose hours no schedule can price, rather than guessing a base", () => {
    const result = calculateBurdenedLaborCost(
      [plain({ craftClassificationId: null })],
      schedules,
      FIFTEEN,
    );
    expect(result.wageCost).toBe(0);
    expect(result.burdenCost).toBe(0);
    expect(result.unpricedHours).toBe(8);
  });

  it("names the percentage on screen once one is in force", () => {
    expect(laborCostBasisLabel(15)).toBe("wage, fringes and 15.00% employer burden");
    expect(laborCostBasisLabel(28.375)).toBe("wage, fringes and 28.375% employer burden");
  });
});

// ---------------------------------------------------------------------------
describe("overtime and double time: the burden follows the MULTIPLIED base", () => {
  const TWENTY = [rate("2026-01-01", "20.000")];

  it("burdens an overtime hour on its overtime dollars", () => {
    const result = calculateBurdenedLaborCost(
      [plain({ hours: 4, payType: "OVERTIME" })],
      schedules,
      TWENTY,
    );
    // base 4 x 45 x 1.5 = 270; 20% = 54. Wage stays 4 x (67.5 + 23) = 362.
    expect(result.wageCost).toBe(362);
    expect(result.burdenCost).toBe(54);
  });

  it("burdens a double-time hour on its double-time dollars", () => {
    const result = calculateBurdenedLaborCost(
      [plain({ hours: 4, payType: "DOUBLE_TIME" })],
      schedules,
      TWENTY,
    );
    // base 4 x 45 x 2 = 360; 20% = 72.
    expect(result.burdenCost).toBe(72);
  });

  it("treats a shift differential as straight time, like the wage math does", () => {
    const result = calculateBurdenedLaborCost(
      [plain({ hours: 8, payType: "SHIFT_DIFFERENTIAL" })],
      schedules,
      TWENTY,
    );
    // base 8 x 45 = 360; 20% = 72.
    expect(result.burdenCost).toBe(72);
  });
});

// ---------------------------------------------------------------------------
// A RATE THAT CHANGED MID-YEAR IS PICKED BY THE ENTRY'S OWN DAY, not by
// today's. Hours worked in March stay costed at March's burden after April's
// has been recorded -- otherwise recording next year's rate silently restates
// a figure somebody has already sent a GC.
// ---------------------------------------------------------------------------
describe("which rate applies to a day", () => {
  const RATES = [rate("2026-01-01", "10.000"), rate("2026-07-01", "20.000")];

  it("uses the rate in force on the day worked, both sides of the change", () => {
    expect(employerBurdenPercentOn(RATES, new Date("2026-06-30T00:00:00.000Z"))).toBe(10);
    expect(employerBurdenPercentOn(RATES, new Date("2026-07-02T00:00:00.000Z"))).toBe(20);
  });

  it("starts the new rate ON its effective day, not the day after", () => {
    // The boundary day itself. A rate dated 1 July is in force on 1 July.
    expect(employerBurdenPercentOn(RATES, new Date("2026-07-01T00:00:00.000Z"))).toBe(20);
    expect(employerBurdenPercentOn(RATES, new Date("2026-06-30T23:59:59.999Z"))).toBe(10);
  });

  it("returns null before the earliest rate rather than reaching backwards", () => {
    expect(employerBurdenPercentOn(RATES, new Date("2025-12-31T00:00:00.000Z"))).toBeNull();
    expect(employerBurdenPercentOn([], new Date("2026-03-02T00:00:00.000Z"))).toBeNull();
  });

  it("does not depend on the order the rates arrive in", () => {
    const reversed = [...RATES].reverse();
    expect(employerBurdenPercentOn(reversed, new Date("2026-08-01T00:00:00.000Z"))).toBe(20);
  });

  it("costs a job whose hours straddle the change at two different rates", () => {
    const result = calculateBurdenedLaborCost(
      [
        plain({ date: new Date("2026-06-30T00:00:00.000Z") }), // 8h, base 360, 10% = 36
        plain({ date: new Date("2026-07-01T00:00:00.000Z") }), // 8h, base 360, 20% = 72
      ],
      schedules,
      RATES,
    );
    expect(result.burdenCost).toBe(36 + 72);
    expect(result.wageCost).toBe(544 * 2);
  });

  it("reads a day the same whatever time of day the entry carries", () => {
    // TimeEntry.date is stored at UTC midnight, but a caller's Date need not
    // be -- labor-cost.ts documents the same truncation for schedules.
    expect(employerBurdenPercentOn(RATES, new Date("2026-07-01T23:30:00.000Z"))).toBe(20);
    expect(employerBurdenPercentOnDay(RATES, "2026-07-01")).toBe(20);
  });
});

// ---------------------------------------------------------------------------
describe("money in cents, rounded once", () => {
  it("multiplies dollars by the percentage to get cents directly", () => {
    // $48,000 of base wages at 15% is $7,200.
    expect(employerBurdenCents(48_000, 15)).toBe(720_000);
  });

  it("rounds the half cent once, at the end, not per time entry", () => {
    // Three entries of $1.005 of base at 1% are 1.005c each -- 1c apiece if
    // rounded individually (3c), 3c from the accumulated $3.015 (3.015c ->
    // 3c). The accumulate-then-round path is the one that matches an
    // accountant multiplying the payroll total.
    const perEntry = 3 * Math.round(1.005 * 1);
    const accumulated = employerBurdenCents(1.005 * 3, 1);
    expect(perEntry).toBe(3);
    expect(accumulated).toBe(3);
    // And on a case where they genuinely differ:
    expect(3 * Math.round(0.4)).toBe(0);
    expect(employerBurdenCents(0.4 * 3, 1)).toBe(1);
  });

  it("never leaves a fraction of a cent in a job-cost figure", () => {
    // 7h at $45.33 base = $317.31; 7.65% of that is 24.27... cents-wise
    // 2427.4215 -> 2427c -> $24.27, and $24.27 has no third decimal.
    const result = calculateBurdenedLaborCost(
      [plain({ hours: 7 })],
      new Map([[JOURNEYMAN, [schedule({ baseWage: 45.33 })]]]),
      [rate("2026-01-01", "7.650")],
    );
    expect(result.burdenCost).toBe(24.27);
    expect(Number.isInteger(Math.round(result.burdenCost * 100))).toBe(true);
    expect(result.burdenCost * 100).toBeCloseTo(2427, 9);
  });
});

// ---------------------------------------------------------------------------
describe("a zero rate and a silly-large one", () => {
  it("treats a recorded 0% as zero burden, which is not the same as no row", () => {
    const zero = calculateBurdenedLaborCost([plain()], schedules, [rate("2026-01-01", "0.000")]);
    expect(zero.burdenCost).toBe(0);
    expect(zero.total).toBe(544);
    // The arithmetic matches "no rate", but the ANSWER to "is one recorded"
    // does not -- 0 and null are different, and the screen says different
    // things.
    expect(employerBurdenPercentOn([rate("2026-01-01", "0.000")], new Date("2026-03-02"))).toBe(0);
    expect(laborCostBasisLabel(0)).toBe("wage, fringes and 0.00% employer burden");
  });

  it("still computes exactly at an absurd percentage rather than clamping silently", () => {
    const silly = calculateBurdenedLaborCost([plain()], schedules, [rate("2026-01-01", "250.000")]);
    // base 360 x 250% = 900.
    expect(silly.burdenCost).toBe(900);
    expect(silly.total).toBe(544 + 900);
  });

  it("but the form refuses to record one, in a sentence that says what to type", () => {
    expect(employerBurdenPercentProblem("0")).toBeNull();
    expect(employerBurdenPercentProblem("18.5")).toBeNull();
    expect(employerBurdenPercentProblem("100")).toBeNull();
    expect(employerBurdenPercentProblem("250")).toContain("more than the wages");
    expect(employerBurdenPercentProblem("-5")).toContain("percentage with up to three places");
    expect(employerBurdenPercentProblem("")).toBe("The burden percentage is required");
    expect(employerBurdenPercentProblem("eighteen")).toContain("percentage");
    expect(employerBurdenPercentProblem("18.5555")).toContain("three places");
  });
});

// ---------------------------------------------------------------------------
describe("the standing the settings page renders", () => {
  const RATES = [rate("2026-01-01", "10.000"), rate("2026-07-01", "20.000"), rate("2027-01-01", "22.000")];

  it("derives current, upcoming and history from the dates alone", () => {
    const standing = employerBurdenStanding(RATES, "2026-08-15");
    expect(standing.current?.percent).toBe("20.000");
    expect(standing.upcoming.map((r) => r.percent)).toEqual(["22.000"]);
    expect(standing.history.map((r) => r.effectiveDate)).toEqual([
      "2027-01-01",
      "2026-07-01",
      "2026-01-01",
    ]);
  });

  it("has no current rate when nothing on file has started", () => {
    const standing = employerBurdenStanding(RATES, "2025-12-31");
    expect(standing.current).toBeNull();
    expect(standing.upcoming).toHaveLength(3);
  });

  it("counts a rate dated today as in force today", () => {
    expect(employerBurdenStanding(RATES, "2026-07-01").current?.percent).toBe("20.000");
  });
});

// ---------------------------------------------------------------------------
describe("how the figures read and what the form refuses", () => {
  it("writes the percentage the way a person typed it", () => {
    expect(employerBurdenPercentText("15.000")).toBe("15.00");
    expect(employerBurdenPercentText("28.375")).toBe("28.375");
    expect(employerBurdenPercentText("7.650")).toBe("7.65");
  });

  it("refuses an impossible effective date rather than sliding it forward", () => {
    // 2026-02-30 silently becomes 2026-03-02 in JavaScript. This is the check
    // the mod rate already owns, shared rather than copied.
    expect(employerBurdenEffectiveDate("2026-02-30")).toBe(
      "That date does not exist — check the day and month",
    );
    expect(employerBurdenEffectiveDate("0025-01-01")).toBe("Check the year on the effective date");
    const good = employerBurdenEffectiveDate("2026-07-01");
    expect(good instanceof Date && good.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});
