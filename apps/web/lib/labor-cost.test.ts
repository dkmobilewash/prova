import { describe, expect, it } from "vitest";
import {
  calculateTimeEntryLaborCost,
  findEffectiveFringeRateSchedule,
  type FringeRateScheduleInput,
} from "./labor-cost";

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

describe("findEffectiveFringeRateSchedule", () => {
  it("finds the schedule effective on a date, inclusive of both ends", () => {
    const old = schedule({ baseWage: 50, effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-06-30") });
    const next = schedule({ baseWage: 60, effectiveFrom: new Date("2026-07-01"), effectiveTo: null });
    expect(findEffectiveFringeRateSchedule([old, next], new Date("2026-06-30"))?.baseWage).toBe(50);
    expect(findEffectiveFringeRateSchedule([old, next], new Date("2026-07-01"))?.baseWage).toBe(60);
  });

  it("never picks the closest schedule when none applies", () => {
    const only = schedule({ effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-06-30") });
    expect(findEffectiveFringeRateSchedule([only], new Date("2025-12-31"))).toBeNull();
    expect(findEffectiveFringeRateSchedule([only], new Date("2026-07-01"))).toBeNull();
    expect(findEffectiveFringeRateSchedule([], new Date("2026-03-01"))).toBeNull();
  });

  describe("issue #104 finding 3: the DB's exclusion constraint permits a SAME-DAY changeover", () => {
    // FringeRateSchedule_no_overlapping_rates (20260824171704) is
    // EXCLUDE USING gist (craftClassificationId WITH =, tsrange(effectiveFrom,
    // COALESCE(effectiveTo, 'infinity')) WITH &&) — tsrange's default bounds
    // are [inclusive, exclusive), so Postgres itself accepts an old schedule
    // ending on the SAME calendar day a new one begins (verified directly
    // against a real Postgres 16 exclusion constraint while investigating
    // this issue: both the same-day and the next-day convention insert
    // cleanly, with no overlap violation either way).
    //
    // Before the fix, both `.effectiveFrom <= date && date <= .effectiveTo`
    // matched on that shared day for BOTH rows, and `.find()` returned
    // whichever the caller's array happened to list first — the exact
    // "the wage on a signed sheet can differ between two page loads" the
    // issue names. The fix makes the choice deterministic regardless of
    // array order: the schedule with the LATEST effectiveFrom wins.
    it("prefers the newer schedule on a same-day changeover, regardless of array order", () => {
      const old = schedule({ baseWage: 50, effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-06-30") });
      const changeoverDay = new Date("2026-06-30");
      const replacement = schedule({ baseWage: 60, effectiveFrom: changeoverDay, effectiveTo: null });

      expect(findEffectiveFringeRateSchedule([old, replacement], changeoverDay)?.baseWage).toBe(60);
      // Same answer no matter which order Postgres happened to hand them
      // back in -- this is the actual bug: before the fix, this second
      // call returned 50 instead of 60 purely because of array order.
      expect(findEffectiveFringeRateSchedule([replacement, old], changeoverDay)?.baseWage).toBe(60);
    });

    it("is deterministic across three schedules regardless of fetch order", () => {
      // Two same-day changeovers back to back: Jan 1 - Mar 1 ends the same
      // day Mar 1 - Jun 1 begins, which ends the same day Jun 1 - onward
      // begins. Querying the second changeover day should always land on
      // the THIRD schedule (the latest effectiveFrom that still matches),
      // never on the one it replaced, regardless of array order.
      const a = schedule({ baseWage: 10, effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-03-01") });
      const b = schedule({ baseWage: 20, effectiveFrom: new Date("2026-03-01"), effectiveTo: new Date("2026-06-01") });
      const c = schedule({ baseWage: 30, effectiveFrom: new Date("2026-06-01"), effectiveTo: null });
      const date = new Date("2026-06-01");
      const orderings = [
        [a, b, c],
        [c, b, a],
        [b, a, c],
      ];
      for (const ordering of orderings) {
        expect(findEffectiveFringeRateSchedule(ordering, date)?.baseWage).toBe(30);
      }
    });
  });

  describe("issue #104 finding 8: a schedule must not stop pricing at midnight on its own last day", () => {
    // The bug lived in comparing full Date+time values: effectiveFrom/To
    // are always UTC midnight, but `asOf` was sometimes a bare `new Date()`
    // carrying the real hour of day (jobs/[id]/page.tsx's
    // `laborRateDateFor(job, new Date())` when a job has no start date).
    // Any call after 00:00 UTC on the schedule's own last calendar day
    // already read as later than `effectiveTo`, so pricing silently
    // stopped hours before the setup screen's own "in force" badge
    // (FringeScheduleList, which compares "YYYY-MM-DD" strings) said it
    // should.
    it("still matches on its last day at any time of day, not only at midnight", () => {
      const closingOut = schedule({
        baseWage: 50,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-06-30T00:00:00.000Z"),
      });
      // The exact failure mode: "now" well after midnight on the schedule's
      // own last day.
      const lateInTheDay = new Date("2026-06-30T22:15:00.000Z");
      expect(findEffectiveFringeRateSchedule([closingOut], lateInTheDay)?.baseWage).toBe(50);
    });

    it("still matches on its first day at any time of day", () => {
      const starting = schedule({
        baseWage: 60,
        effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        effectiveTo: null,
      });
      const earlyMorning = new Date("2026-07-01T00:00:01.000Z");
      expect(findEffectiveFringeRateSchedule([starting], earlyMorning)?.baseWage).toBe(60);
    });

    it("does not match the day AFTER its last day, at any time of day", () => {
      const closingOut = schedule({
        baseWage: 50,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveTo: new Date("2026-06-30T00:00:00.000Z"),
      });
      expect(findEffectiveFringeRateSchedule([closingOut], new Date("2026-07-01T00:00:01.000Z"))).toBeNull();
    });
  });
});

describe("calculateTimeEntryLaborCost", () => {
  it("burdens straight hours at base wage plus flat fringe", () => {
    const cost = calculateTimeEntryLaborCost(
      { hours: 8, payType: "STRAIGHT", date: new Date("2026-03-01") },
      schedule(),
    );
    // 8 x ($45 base + $23 fringe)
    expect(cost).toBe(544);
  });

  it("multiplies only the base wage for overtime, never the fringe", () => {
    const cost = calculateTimeEntryLaborCost(
      { hours: 8, payType: "OVERTIME", date: new Date("2026-03-01") },
      schedule(),
    );
    // 8 x ($45 x 1.5 + $23 flat fringe)
    expect(cost).toBe(724);
  });

  it("returns null rather than guessing when no schedule applies", () => {
    expect(
      calculateTimeEntryLaborCost({ hours: 8, payType: "STRAIGHT", date: new Date("2026-03-01") }, null),
    ).toBeNull();
  });
});
