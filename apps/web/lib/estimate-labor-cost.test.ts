import { describe, expect, it } from "vitest";
import { burdenedHourlyRate, estimateBurdenedLaborCost, laborRateDateFor } from "./estimate-labor-cost";

const schedule = (from: string, to: string | null, baseWage: number) => ({
  baseWage,
  pensionRate: 5,
  vacationRate: 3,
  healthWelfareRate: 10,
  trainingRate: 2, // fringe total: $20/hr
  effectiveFrom: new Date(from),
  effectiveTo: to ? new Date(to) : null,
});

describe("estimateBurdenedLaborCost", () => {
  const schedules = [schedule("2026-01-01", "2026-06-30", 50), schedule("2026-07-01", null, 60)];

  it("burdens hours at base wage plus fringes", () => {
    // 10 hrs x ($50 base + $20 fringe)
    expect(estimateBurdenedLaborCost(10, schedules, new Date("2026-03-01"))).toBe(700);
  });

  it("uses the schedule effective on the given date, not the newest one", () => {
    // Bidding work that starts before the increase must price at the old rate.
    expect(estimateBurdenedLaborCost(10, schedules, new Date("2026-03-01"))).toBe(700);
    expect(estimateBurdenedLaborCost(10, schedules, new Date("2026-08-01"))).toBe(800);
  });

  it("shows nothing rather than a wrong number when no schedule applies", () => {
    // Never picks the closest schedule — a bid priced at the wrong era's
    // rate is worse than a bid with no labor figure on it.
    expect(estimateBurdenedLaborCost(10, schedules, new Date("2025-01-01"))).toBeNull();
    expect(estimateBurdenedLaborCost(10, [], new Date("2026-03-01"))).toBeNull();
  });

  it("has nothing to say without hours", () => {
    expect(estimateBurdenedLaborCost(null, schedules, new Date("2026-03-01"))).toBeNull();
    expect(estimateBurdenedLaborCost(0, schedules, new Date("2026-03-01"))).toBeNull();
  });

  it("never invents an overtime premium at bid time", () => {
    // Estimate hours are straight time. Nobody plans a bid in OT, and a
    // premium applied here would inflate every estimate.
    const straightRate = estimateBurdenedLaborCost(1, schedules, new Date("2026-03-01"));
    expect(straightRate).toBe(70);
    expect(estimateBurdenedLaborCost(100, schedules, new Date("2026-03-01"))).toBe(
      straightRate! * 100,
    );
  });

  it("treats a missing fringe component as zero, not as no schedule", () => {
    const bare = [
      {
        baseWage: 40,
        pensionRate: null,
        vacationRate: null,
        healthWelfareRate: null,
        trainingRate: null,
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: null,
      },
    ];
    expect(estimateBurdenedLaborCost(2, bare, new Date("2026-03-01"))).toBe(80);
  });
});

describe("laborRateDateFor", () => {
  const today = new Date("2026-03-01");

  it("prices at the planned start date when the job has one", () => {
    // A job starting after a rate step should be bid at the rate that will
    // actually be paid, not the one in force when the estimate was opened.
    expect(laborRateDateFor({ startDate: new Date("2026-09-01") }, today)).toEqual(
      new Date("2026-09-01"),
    );
  });

  it("falls back to today when no start date is set", () => {
    expect(laborRateDateFor({ startDate: null }, today)).toEqual(today);
  });
});

describe("burdenedHourlyRate", () => {
  const schedules = [schedule("2026-01-01", "2026-06-30", 50), schedule("2026-07-01", null, 60)];

  it("is the cost of exactly one hour", () => {
    expect(burdenedHourlyRate(schedules, new Date("2026-03-01"))).toBe(70);
  });

  it("rate x hours equals the saved line's figure, at every quantity", () => {
    // The live hint multiplies this rate client-side while the saved row is
    // priced by estimateBurdenedLaborCost. If those two ever disagreed, the
    // preview would quote a different number from the row it creates.
    const asOf = new Date("2026-08-01");
    const rate = burdenedHourlyRate(schedules, asOf)!;
    for (const hours of [0.25, 1, 7.5, 80, 1234.56]) {
      expect(rate * hours).toBeCloseTo(estimateBurdenedLaborCost(hours, schedules, asOf)!, 9);
    }
  });

  it("has no rate to give when no schedule is effective", () => {
    expect(burdenedHourlyRate(schedules, new Date("2025-01-01"))).toBeNull();
    expect(burdenedHourlyRate([], new Date("2026-03-01"))).toBeNull();
  });
});
