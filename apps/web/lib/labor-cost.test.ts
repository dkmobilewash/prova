import { describe, expect, it } from "vitest";
import {
  calculateTimeEntryLaborCost,
  effectiveRangesOverlap,
  findEffectiveFringeRateSchedule,
  type FringeRateScheduleInput,
} from "./labor-cost";

/**
 * The rate that applies to an hour, and the money that comes out of it.
 *
 * Both defects here were found in issue #104 and both put a different
 * figure on a certified payroll sheet depending on nothing a person could
 * see. Every assertion below is a hand-worked dollar amount, not a
 * "returns something" — a wage that is merely non-null is exactly what
 * shipped.
 */

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** $30.00 base + $12.00 of fringes = $42.00 an hour, in force to 06-30. */
const oldRate: FringeRateScheduleInput = {
  baseWage: 30,
  pensionRate: 5,
  vacationRate: 2,
  healthWelfareRate: 4,
  trainingRate: 1,
  effectiveFrom: day("2026-01-01"),
  effectiveTo: day("2026-06-30"),
};

/** $40.00 base + $18.00 of fringes = $58.00 an hour, in force FROM 06-30 —
 * the same day the old one ends. The database's exclusion constraint is
 * built on a half-open `tsrange`, so it accepts this pair. */
const newRate: FringeRateScheduleInput = {
  baseWage: 40,
  pensionRate: 8,
  vacationRate: 3,
  healthWelfareRate: 6,
  trainingRate: 1,
  effectiveFrom: day("2026-06-30"),
  effectiveTo: null,
};

const eightStraight = (schedule: FringeRateScheduleInput | null) =>
  calculateTimeEntryLaborCost(
    { hours: 8, payType: "STRAIGHT", date: day("2026-06-30") },
    schedule,
  );

describe("findEffectiveFringeRateSchedule on a changeover day", () => {
  it("prices eight straight hours at $464, whichever order the rows arrive in", () => {
    // 8 x $58.00. The defect: `.find()` took whichever row the query
    // returned first, and two of the three call sites do not order their
    // `fringeRateSchedules` include at all — so the same page could print
    // $336 on one load and $464 on the next, on a document someone signs.
    const oldFirst = findEffectiveFringeRateSchedule([oldRate, newRate], day("2026-06-30"));
    const newFirst = findEffectiveFringeRateSchedule([newRate, oldRate], day("2026-06-30"));

    expect(eightStraight(oldFirst)).toBe(464);
    expect(eightStraight(newFirst)).toBe(464);
  });

  it("still prices the day BEFORE the changeover at $336", () => {
    // 8 x $42.00. The new rule must not drag the newer rate backwards.
    const schedule = findEffectiveFringeRateSchedule([newRate, oldRate], day("2026-06-29"));
    expect(
      calculateTimeEntryLaborCost(
        { hours: 8, payType: "STRAIGHT", date: day("2026-06-29") },
        schedule,
      ),
    ).toBe(336);
  });
});

describe("a schedule prices its own final day", () => {
  const only = [oldRate];

  it("at 18:45 on the last day, not just at midnight", () => {
    // The defect (#104 item 8): `laborRateDateFor` falls back to
    // `new Date()`, which carries a time of day, and the comparison was
    // `date <= effectiveTo` against a UTC-midnight `effectiveTo`. So from
    // 00:00:00.001 on 2026-06-30 the rate stopped pricing — while the
    // setup screen, which compares yyyy-mm-dd strings, still badged it
    // "in force". Two clocks, one question.
    const atMidnight = findEffectiveFringeRateSchedule(only, day("2026-06-30"));
    const lateInTheDay = findEffectiveFringeRateSchedule(
      only,
      new Date("2026-06-30T18:45:31.412Z"),
    );

    expect(eightStraight(atMidnight)).toBe(336);
    expect(eightStraight(lateInTheDay)).toBe(336);
  });

  it("and stops the day after, at any hour", () => {
    expect(findEffectiveFringeRateSchedule(only, day("2026-07-01"))).toBeNull();
    expect(
      findEffectiveFringeRateSchedule(only, new Date("2026-07-01T23:59:59.999Z")),
    ).toBeNull();
  });

  it("does not start early: the day before effectiveFrom is unpriced", () => {
    expect(findEffectiveFringeRateSchedule(only, day("2025-12-31"))).toBeNull();
    expect(
      findEffectiveFringeRateSchedule(only, new Date("2025-12-31T23:59:59.999Z")),
    ).toBeNull();
  });
});

describe("effectiveRangesOverlap treats effectiveTo as inclusive", () => {
  it("calls the abutting pair Postgres accepts an overlap", () => {
    // This exact pair is storable: `tsrange('2026-01-01','2026-06-30')` and
    // `tsrange('2026-06-30', 'infinity')` do not overlap for Postgres,
    // because tsrange is half-open. The application prices 06-30 from both.
    expect(effectiveRangesOverlap(oldRate, newRate)).toBe(true);
  });

  it("leaves a clean handover alone", () => {
    expect(
      effectiveRangesOverlap(oldRate, { effectiveFrom: day("2026-07-01"), effectiveTo: null }),
    ).toBe(false);
  });

  it("catches a new range wholly inside an open-ended one", () => {
    const openEnded = { effectiveFrom: day("2026-01-01"), effectiveTo: null };
    expect(
      effectiveRangesOverlap(openEnded, {
        effectiveFrom: day("2030-05-05"),
        effectiveTo: day("2030-05-06"),
      }),
    ).toBe(true);
  });

  it("catches an existing range wholly inside a new one", () => {
    expect(
      effectiveRangesOverlap(oldRate, {
        effectiveFrom: day("2025-01-01"),
        effectiveTo: day("2027-01-01"),
      }),
    ).toBe(true);
  });

  it("ignores a time of day on either side", () => {
    expect(
      effectiveRangesOverlap(
        { effectiveFrom: day("2026-01-01"), effectiveTo: new Date("2026-06-30T23:59:00.000Z") },
        { effectiveFrom: new Date("2026-07-01T06:00:00.000Z"), effectiveTo: null },
      ),
    ).toBe(false);
  });
});
