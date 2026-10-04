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
    expect(estimateBurdenedLaborCost(10, schedules, new Date("2026-03-01"), null)).toBe(700);
  });

  it("uses the schedule effective on the given date, not the newest one", () => {
    // Bidding work that starts before the increase must price at the old rate.
    expect(estimateBurdenedLaborCost(10, schedules, new Date("2026-03-01"), null)).toBe(700);
    expect(estimateBurdenedLaborCost(10, schedules, new Date("2026-08-01"), null)).toBe(800);
  });

  it("shows nothing rather than a wrong number when no schedule applies", () => {
    // Never picks the closest schedule — a bid priced at the wrong era's
    // rate is worse than a bid with no labor figure on it.
    expect(estimateBurdenedLaborCost(10, schedules, new Date("2025-01-01"), null)).toBeNull();
    expect(estimateBurdenedLaborCost(10, [], new Date("2026-03-01"), null)).toBeNull();
  });

  it("has nothing to say without hours", () => {
    expect(estimateBurdenedLaborCost(null, schedules, new Date("2026-03-01"), null)).toBeNull();
    expect(estimateBurdenedLaborCost(0, schedules, new Date("2026-03-01"), null)).toBeNull();
  });

  it("never invents an overtime premium at bid time", () => {
    // Estimate hours are straight time. Nobody plans a bid in OT, and a
    // premium applied here would inflate every estimate.
    const straightRate = estimateBurdenedLaborCost(1, schedules, new Date("2026-03-01"), null);
    expect(straightRate).toBe(70);
    expect(estimateBurdenedLaborCost(100, schedules, new Date("2026-03-01"), null)).toBe(
      straightRate! * 100,
    );
  });

  it("issue #104 finding 8: still prices on a schedule's last day at any time of day", () => {
    // jobs/[id]/page.tsx calls laborRateDateFor(job, new Date()) when a job
    // has no start date -- a bare "now", carrying whatever hour the
    // request happens to land on, compared against effectiveFrom/To values
    // that are always UTC midnight. The bug: any time after 00:00 UTC on a
    // schedule's own LAST calendar day already read as later than
    // effectiveTo, so the estimate silently stopped pricing hours before
    // the setup screen's own "in force" badge said the schedule had ended.
    const lateOnTheLastDay = new Date("2026-06-30T19:45:00.000Z");
    expect(estimateBurdenedLaborCost(10, schedules, lateOnTheLastDay, null)).toBe(700);
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
    expect(estimateBurdenedLaborCost(2, bare, new Date("2026-03-01"), null)).toBe(80);
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
    expect(burdenedHourlyRate(schedules, new Date("2026-03-01"), null)).toBe(70);
  });

  it("rate x hours equals the saved line's figure, at every quantity", () => {
    // The live hint multiplies this rate client-side while the saved row is
    // priced by estimateBurdenedLaborCost. If those two ever disagreed, the
    // preview would quote a different number from the row it creates.
    const asOf = new Date("2026-08-01");
    const rate = burdenedHourlyRate(schedules, asOf, null)!;
    for (const hours of [0.25, 1, 7.5, 80, 1234.56]) {
      expect(rate * hours).toBeCloseTo(estimateBurdenedLaborCost(hours, schedules, asOf, null)!, 9);
    }
  });

  it("has no rate to give when no schedule is effective", () => {
    expect(burdenedHourlyRate(schedules, new Date("2025-01-01"), null)).toBeNull();
    expect(burdenedHourlyRate([], new Date("2026-03-01"), null)).toBeNull();
  });
});

describe("the employer burden, on the same basis the actuals use", () => {
  const schedules = [schedule("2026-01-01", "2026-06-30", 50), schedule("2026-07-01", null, 60)];
  const march = new Date("2026-03-01");

  it("WITH NO RATE RECORDED, NOTHING MOVES", () => {
    // The guarantee the whole change rests on, and the opt-out for a shop that
    // carries burden inside its overhead percentage instead: don't record a
    // rate and nothing is counted twice. Mirrors `employer-burden.test.ts`'s
    // own "with no rate recorded, nothing moves" on the actuals side.
    //
    // Every other case in this file passes `null` and still expects the figure
    // it expected before this parameter existed, which is the same assertion
    // made twelve more times.
    expect(estimateBurdenedLaborCost(10, schedules, march, null)).toBe(700);
    expect(burdenedHourlyRate(schedules, march, null)).toBe(70);
  });

  it("adds the percentage of the BASE WAGE, never of the fringes", () => {
    // 10 hrs x $50 base = $500 base wage; 10 x $20 fringe = $200.
    // At 15%, the burden is 15% of $500 = $75 — NOT 15% of $700 = $105.
    //
    // `employer-burden.ts` states that as a modelling choice for a CPA to
    // confirm: bona fide benefit-plan contributions sit outside the wage base
    // employer payroll taxes are computed on, so burdening them again would
    // count the same dollars twice. The estimate asks the same question of the
    // same base-wage function rather than inventing a second rule.
    expect(estimateBurdenedLaborCost(10, schedules, march, 15)).toBe(775);
  });

  it("a recorded ZERO is a statement, and reads the same as no burden", () => {
    // null and 0 are different answers — "nothing recorded" against "somebody
    // worked it out and it came to nothing". The arithmetic agrees; the
    // sentence on screen does not, which is `laborCostBasisLabel`'s job.
    expect(estimateBurdenedLaborCost(10, schedules, march, 0)).toBe(700);
  });

  it("prices the burden at the SCHEDULE's own era, not the newest wage", () => {
    // The burden is a percentage OF a base wage, so it inherits the
    // rate-stepping that `laborRateDateFor` exists for. August is the $60 era:
    // base $600, fringe $200, burden 15% of $600 = $90.
    expect(estimateBurdenedLaborCost(10, schedules, new Date("2026-08-01"), 15)).toBe(890);
  });

  it("keeps rate x hours EXACT with a burden in force", () => {
    // The property the live preview depends on, re-checked with the new term.
    // It holds because nothing here rounds: the actuals path rounds once at the
    // end because it posts a ledger figure across many TimeEntry rows, and this
    // is one line, linear in hours, rounded only when written to a money
    // column. A rounded burden here would break this at the half cent.
    const asOf = new Date("2026-08-01");
    const rate = burdenedHourlyRate(schedules, asOf, 15)!;
    for (const hours of [0.25, 1, 7.5, 80, 1234.56]) {
      expect(rate * hours).toBeCloseTo(estimateBurdenedLaborCost(hours, schedules, asOf, 15)!, 9);
    }
  });

  it("still refuses to invent a rate, burden or no burden", () => {
    // A burden percentage must never become a reason to price hours the fringe
    // schedules cannot price. No schedule, no number — "because a wrong one
    // gets bid" applies to the burdened figure exactly as it did before.
    expect(estimateBurdenedLaborCost(10, schedules, new Date("2025-01-01"), 15)).toBeNull();
    expect(estimateBurdenedLaborCost(10, [], march, 15)).toBeNull();
    expect(estimateBurdenedLaborCost(null, schedules, march, 15)).toBeNull();
  });

  it("matches what the ACTUALS path would charge for the same hours", () => {
    // THE WHOLE POINT, stated as arithmetic. `labor-job-cost.ts` prices logged
    // hours as wage + fringes + percent-of-base, and rounds the burden to whole
    // cents once. For a figure that lands on an exact cent the two agree
    // exactly; this is the case that would have been a systematic overrun on
    // every job before 2026-10-04.
    const hours = 80;
    const wageAndFringes = 80 * (50 + 20); // $5,600
    const burden = (80 * 50 * 15) / 100; // 15% of $4,000 base = $600
    expect(estimateBurdenedLaborCost(hours, schedules, march, 15)).toBe(wageAndFringes + burden);
    expect(estimateBurdenedLaborCost(hours, schedules, march, 15)).toBe(6200);
  });
});
