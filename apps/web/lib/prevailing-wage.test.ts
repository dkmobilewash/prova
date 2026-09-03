import { describe, expect, it } from "vitest";
import {
  findEffectiveRuleSet,
  hasOvertimeRules,
  reviewDays,
  type DayEntryInput,
  type PrevailingWageRuleSetInput,
} from "./prevailing-wage";

const ruleSet = (over: Partial<PrevailingWageRuleSetInput> = {}): PrevailingWageRuleSetInput => ({
  id: "rs_1",
  name: "Test rules",
  jurisdiction: "Testland",
  dailyOvertimeAfterHours: null,
  dailyDoubleTimeAfterHours: null,
  weeklyOvertimeAfterHours: null,
  seventhDayOvertimeAfterHours: null,
  seventhDayDoubleTimeAfterHours: null,
  filingDueDays: null,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  ...over,
});

const day = (date: string, hours: number, payType: DayEntryInput["payType"] = "STRAIGHT") => ({
  date,
  hours,
  payType,
});

describe("findEffectiveRuleSet", () => {
  const older = { effectiveFrom: "2026-01-01", effectiveTo: "2026-05-31", id: "old" };
  const newer = { effectiveFrom: "2026-06-01", effectiveTo: null, id: "new" };

  it("uses the rules in force on the day, not today's", () => {
    // The whole reason this table is effective-dated. A legislature
    // amending a threshold must not rewrite how a closed week reads.
    expect(findEffectiveRuleSet([older, newer], "2026-03-15")?.id).toBe("old");
    expect(findEffectiveRuleSet([older, newer], "2026-08-15")?.id).toBe("new");
  });

  it("treats effectiveTo as inclusive", () => {
    expect(findEffectiveRuleSet([older, newer], "2026-05-31")?.id).toBe("old");
    expect(findEffectiveRuleSet([older, newer], "2026-06-01")?.id).toBe("new");
  });

  it("returns null rather than the nearest match", () => {
    // A near-miss standing in for the real thing is how a review starts
    // producing confident wrong answers.
    expect(findEffectiveRuleSet([newer], "2026-01-15")).toBeNull();
  });
});

describe("hasOvertimeRules", () => {
  it("is false for a rule set recorded only for its filing details", () => {
    expect(hasOvertimeRules(ruleSet({ filingDueDays: 7 }))).toBe(false);
  });

  it("is true as soon as any threshold is recorded — including zero", () => {
    // Zero is a real threshold: the premium applies from the first hour.
    expect(hasOvertimeRules(ruleSet({ seventhDayOvertimeAfterHours: 0 }))).toBe(true);
    expect(hasOvertimeRules(ruleSet({ weeklyOvertimeAfterHours: 40 }))).toBe(true);
  });
});

describe("reviewDays — when it refuses to judge", () => {
  it("checks nothing without a rule set, and says so", () => {
    const review = reviewDays([day("2026-08-17", 10)], null);
    expect(review.checked).toBe(false);
    expect(review.reason).toContain("No prevailing wage rule set");
    expect(review.disagreements).toEqual([]);
    // The hours are still reported — the day is shown, just not judged.
    expect(review.days).toHaveLength(1);
    expect(review.totalHours).toBe(10);
  });

  it("checks nothing when the rule set records no thresholds", () => {
    // Never assumes eight. This is the line between applying rules and
    // asserting law nobody told us.
    const review = reviewDays([day("2026-08-17", 10)], ruleSet({ filingDueDays: 7 }));
    expect(review.checked).toBe(false);
    expect(review.reason).toContain("no overtime thresholds");
    expect(review.disagreements).toEqual([]);
  });

  it("reports a shift-differential day without judging it", () => {
    // A premium for WHEN the shift ran, not how long it was. No
    // hours-based rule has anything to say about it.
    const review = reviewDays(
      [day("2026-08-17", 8, "SHIFT_DIFFERENTIAL")],
      ruleSet({ dailyOvertimeAfterHours: 8 }),
    );
    expect(review.checked).toBe(true);
    expect(review.days[0].skipped).toBe("SHIFT_DIFFERENTIAL");
    expect(review.days[0].expected).toBeNull();
    expect(review.disagreements).toEqual([]);
  });
});

describe("reviewDays — daily thresholds", () => {
  const daily = ruleSet({ dailyOvertimeAfterHours: 8, dailyDoubleTimeAfterHours: 12 });

  it("agrees when the entered split already matches", () => {
    const review = reviewDays(
      [day("2026-08-17", 8), day("2026-08-17", 2, "OVERTIME")],
      daily,
    );
    expect(review.days[0].expected).toMatchObject({ STRAIGHT: 8, OVERTIME: 2, DOUBLE_TIME: 0 });
    expect(review.disagreements).toEqual([]);
  });

  it("flags ten straight hours where the rule says eight", () => {
    const review = reviewDays([day("2026-08-17", 10)], daily);
    expect(review.disagreements).toHaveLength(1);
    expect(review.days[0].entered.STRAIGHT).toBe(10);
    expect(review.days[0].expected).toMatchObject({ STRAIGHT: 8, OVERTIME: 2, DOUBLE_TIME: 0 });
  });

  it("splits three ways past the double-time threshold", () => {
    const review = reviewDays([day("2026-08-17", 14)], daily);
    expect(review.days[0].expected).toMatchObject({ STRAIGHT: 8, OVERTIME: 4, DOUBLE_TIME: 2 });
  });

  it("never crosses into a premium with no recorded trigger", () => {
    // Double time recorded, overtime not: hours run straight to the
    // double-time threshold rather than inventing an overtime band.
    const review = reviewDays([day("2026-08-17", 14)], ruleSet({ dailyDoubleTimeAfterHours: 12 }));
    expect(review.days[0].expected).toMatchObject({ STRAIGHT: 12, OVERTIME: 0, DOUBLE_TIME: 2 });
  });

  it("does not produce negative overtime from a back-to-front rule set", () => {
    // A data-entry error (double time before overtime). Clamped rather
    // than allowed to produce arithmetic nonsense.
    const review = reviewDays(
      [day("2026-08-17", 14)],
      ruleSet({ dailyOvertimeAfterHours: 12, dailyDoubleTimeAfterHours: 8 }),
    );
    const expected = review.days[0].expected as Record<string, number>;
    expect(expected.OVERTIME).toBeGreaterThanOrEqual(0);
    expect(expected.STRAIGHT + expected.OVERTIME + expected.DOUBLE_TIME).toBe(14);
  });
});

describe("reviewDays — the weekly threshold", () => {
  const weekly = ruleSet({ weeklyOvertimeAfterHours: 40 });

  it("converts the hours past forty, taking them from the latest days", () => {
    // You cross forty at the end of a week, not at the start. Converting
    // the earliest hours would report Monday as overtime because of
    // Friday.
    const review = reviewDays(
      ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"].map((d) => day(d, 9)),
      weekly,
    );
    expect(review.weeklyThresholdApplied).toBe(true);
    expect(review.days[0].expected).toMatchObject({ STRAIGHT: 9, OVERTIME: 0 });
    expect(review.days[4].expected).toMatchObject({ STRAIGHT: 4, OVERTIME: 5 });
    expect(review.days.reduce((s, d) => s + (d.expected?.OVERTIME ?? 0), 0)).toBe(5);
  });

  it("leaves a week under the threshold alone", () => {
    const review = reviewDays(
      ["2026-08-17", "2026-08-18", "2026-08-19"].map((d) => day(d, 8)),
      weekly,
    );
    expect(review.weeklyThresholdApplied).toBe(false);
    expect(review.disagreements).toEqual([]);
  });

  it("stacks on top of the daily rule rather than replacing it", () => {
    const both = ruleSet({ dailyOvertimeAfterHours: 8, weeklyOvertimeAfterHours: 40 });
    const review = reviewDays(
      ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"].map((d) =>
        day(d, 8),
      ),
      both,
    );
    // 48 hours, none of it past a daily 8, so the daily rule moves
    // nothing — and the weekly rule still has to move the last 8.
    expect(review.days[5].expected).toMatchObject({ STRAIGHT: 0, OVERTIME: 8 });
    expect(review.days[0].expected).toMatchObject({ STRAIGHT: 8, OVERTIME: 0 });
  });
});

describe("reviewDays — the seventh consecutive day", () => {
  const seventh = ruleSet({
    dailyOvertimeAfterHours: 8,
    dailyDoubleTimeAfterHours: 12,
    seventhDayOvertimeAfterHours: 0,
    seventhDayDoubleTimeAfterHours: 8,
  });

  const sevenDays = [
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-22",
    "2026-08-23",
  ];

  it("treats every hour of the seventh straight day as premium", () => {
    const review = reviewDays(sevenDays.map((d) => day(d, 8)), seventh);
    expect(review.days[6].consecutiveDay).toBe(7);
    // Zero threshold: overtime from the first hour, double time after 8.
    expect(review.days[6].expected).toMatchObject({ STRAIGHT: 0, OVERTIME: 8, DOUBLE_TIME: 0 });
    expect(review.days[5].expected).toMatchObject({ STRAIGHT: 8, OVERTIME: 0 });
  });

  it("restarts the run after a day off", () => {
    const withGap = [...sevenDays.slice(0, 3), ...sevenDays.slice(4)];
    const review = reviewDays(withGap.map((d) => day(d, 8)), seventh);
    expect(Math.max(...review.days.map((d) => d.consecutiveDay))).toBeLessThan(7);
    expect(review.days.every((d) => d.expected?.STRAIGHT === 8)).toBe(true);
  });

  it("uses the ordinary daily rule on a seventh day when no seventh-day rule is recorded", () => {
    const review = reviewDays(
      sevenDays.map((d) => day(d, 10)),
      ruleSet({ dailyOvertimeAfterHours: 8 }),
    );
    expect(review.days[6].expected).toMatchObject({ STRAIGHT: 8, OVERTIME: 2 });
  });
});

describe("reviewDays — comparison", () => {
  it("does not report a float artefact as a disagreement", () => {
    // Hours are Decimal(5,2); 7.99999999 must not read as disagreeing
    // with 8.
    const review = reviewDays(
      [day("2026-08-17", 0.1), day("2026-08-17", 0.2)],
      ruleSet({ dailyOvertimeAfterHours: 8 }),
    );
    expect(review.disagreements).toEqual([]);
  });

  it("ignores which day the entries arrived in, only which day they are for", () => {
    const review = reviewDays(
      [day("2026-08-19", 10), day("2026-08-17", 10)],
      ruleSet({ dailyOvertimeAfterHours: 8 }),
    );
    expect(review.days.map((d) => d.date)).toEqual(["2026-08-17", "2026-08-19"]);
    expect(review.disagreements).toHaveLength(2);
  });
});
