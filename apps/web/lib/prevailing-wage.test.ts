import { describe, expect, it } from "vitest";
import {
  findEffectiveRuleSet,
  hasOvertimeRules,
  reviewDays,
  reviewIsClean,
  weeklyUnresolvedSentence,
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

  describe("the answer cannot depend on the order the rule sets arrived in", () => {
    // PrevailingWageRuleSet_no_overlapping_rules (20260902021139) is
    // EXCLUDE USING gist (companyId WITH =, jurisdiction WITH =,
    // tsrange(effectiveFrom, COALESCE(effectiveTo, 'infinity')) WITH &&).
    // tsrange's default bounds are [inclusive, exclusive), so two rule sets
    // where A.effectiveTo == B.effectiveFrom are ADJACENT to Postgres, not
    // overlapping, and both insert cleanly — while the lookup above treats
    // effectiveTo as inclusive, so BOTH match on that shared day. The same
    // hole FringeRateSchedule had (issue #104 finding 3), in the same
    // shape, and the migration's own comment states the cost: "the rules
    // that applied that week" would depend on row order.
    //
    // The caller (lib/prevailing-wage-query.ts) reads these with
    // findMany, and Postgres guarantees no order without an ORDER BY, so
    // "whichever came first" is not a stable choice — a payroll clerk can
    // get two different overtime classifications for one signed week from
    // two page loads. Determinism is asserted HERE, in the pure function,
    // so it cannot be lost by a caller forgetting an orderBy.
    it("prefers the later rule set on a same-day changeover, in both array orders", () => {
      const ending = { effectiveFrom: "2026-01-01", effectiveTo: "2026-06-01", id: "rs_ending" };
      const starting = { effectiveFrom: "2026-06-01", effectiveTo: null, id: "rs_starting" };
      const sharedDay = "2026-06-01";

      expect(findEffectiveRuleSet([ending, starting], sharedDay)?.id).toBe("rs_starting");
      // The actual bug: before the fix this second call returned
      // "rs_ending", purely because of array order.
      expect(findEffectiveRuleSet([starting, ending], sharedDay)?.id).toBe("rs_starting");
    });

    it("is deterministic across three rule sets in every fetch order", () => {
      // Two back-to-back same-day changeovers. The second changeover day is
      // covered by both b and c; the latest effectiveFrom that still
      // matches is c, in every ordering.
      const a = { effectiveFrom: "2026-01-01", effectiveTo: "2026-03-01", id: "rs_a" };
      const b = { effectiveFrom: "2026-03-01", effectiveTo: "2026-06-01", id: "rs_b" };
      const c = { effectiveFrom: "2026-06-01", effectiveTo: null, id: "rs_c" };
      const orderings = [
        [a, b, c],
        [c, b, a],
        [b, a, c],
        [c, a, b],
      ];
      for (const ordering of orderings) {
        expect(findEffectiveRuleSet(ordering, "2026-06-01")?.id).toBe("rs_c");
      }
    });

    it("breaks an identical-effectiveFrom tie on a stable key, not array order", () => {
      // Reachable, not hypothetical. createPrevailingWageRuleSet rejects
      // only effectiveTo STRICTLY BEFORE effectiveFrom
      // (lib/actions/prevailingWage.ts), so a one-day rule set with
      // effectiveTo == effectiveFrom is accepted — and its tsrange is
      // [x, x), which is EMPTY, and an empty range overlaps nothing. The
      // exclusion constraint therefore cannot refuse it alongside a real
      // rule set beginning the same day, and both share an effectiveFrom.
      //
      // "Latest effectiveFrom wins" has nothing left to compare here, so a
      // reduce with a strict > silently falls back to array order — the
      // flaw carried by labor-cost.ts's equivalent. The id is the primary
      // key, so comparing it is a TOTAL order and always answers.
      const oneDay = { effectiveFrom: "2026-06-01", effectiveTo: "2026-06-01", id: "rs_aaa" };
      const ongoing = { effectiveFrom: "2026-06-01", effectiveTo: null, id: "rs_zzz" };

      const forwards = findEffectiveRuleSet([oneDay, ongoing], "2026-06-01");
      const backwards = findEffectiveRuleSet([ongoing, oneDay], "2026-06-01");
      expect(forwards?.id).toBe(backwards?.id);
      // Documented tiebreak: the greater id. Arbitrary as a judgment about
      // which rule set a clerk meant — an id cannot know that — but stable,
      // which is the only property being claimed.
      expect(forwards?.id).toBe("rs_zzz");
    });
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

describe("reviewDays — shift-differential hours and the weekly threshold", () => {
  // THE REPRODUCTION. Mon-Fri eight straight hours, then eight
  // shift-differential hours on Saturday: forty-eight hours worked, and a
  // forty-hour week. Eight hours have crossed the weekly threshold.
  //
  // Before this was fixed, the Saturday contributed ZERO to the weekly
  // total (its `expected` is null, and the weekly pass summed
  // `day.expected?.STRAIGHT ?? 0`), so the threshold never tripped and the
  // page printed "Every day matches what the rules imply." over a week
  // owing eight hours of overtime premium. A footnote explained the
  // Saturday; nothing said Monday to Friday's verdict had been affected.
  const rules = ruleSet({ dailyOvertimeAfterHours: 8, weeklyOvertimeAfterHours: 40 });
  const monToFri = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"];
  const saturday = "2026-08-22";

  const withShiftDifferential = reviewDays(
    [...monToFri.map((d) => day(d, 8)), day(saturday, 8, "SHIFT_DIFFERENTIAL")],
    rules,
  );
  // The control the auditor ran alongside it: identical hours, Saturday
  // entered as straight time. This one has always been right, and it is
  // here so a regression cannot quietly make BOTH weeks wrong together.
  const control = reviewDays([...monToFri.map((d) => day(d, 8)), day(saturday, 8)], rules);

  it("counts them toward the forty, so the week is not certified clean", () => {
    expect(withShiftDifferential.totalHours).toBe(48);
    expect(control.totalHours).toBe(48);
    // The control finds its eight hours on the Saturday.
    expect(control.days[5].expected).toMatchObject({ STRAIGHT: 0, OVERTIME: 8 });
    expect(control.disagreements).toHaveLength(1);
    // The suspect must not come back with nothing to say about a week
    // that is eight hours over the threshold.
    expect(withShiftDifferential.weeklyUnresolved).toEqual([{ date: saturday, hours: 8 }]);
  });

  it("does not manufacture overtime on Monday to Friday instead", () => {
    // The hours that crossed forty are SATURDAY's. Pushing the excess back
    // onto the last judgeable day would report Friday as overtime for
    // hours worked inside the first forty of the week — a different wrong
    // answer, not a fix.
    for (const index of [0, 1, 2, 3, 4]) {
      expect(withShiftDifferential.days[index].expected).toMatchObject({
        STRAIGHT: 8,
        OVERTIME: 0,
        DOUBLE_TIME: 0,
      });
    }
    expect(withShiftDifferential.disagreements).toEqual([]);
    expect(withShiftDifferential.weeklyThresholdApplied).toBe(false);
  });

  it("still judges the days it can when the excess lands on judgeable hours", () => {
    // Shift differential on MONDAY this time. Those eight hours sit inside
    // the first forty, so nothing about them is unresolved, and the eight
    // hours past forty are Saturday's ordinary straight time.
    const review = reviewDays(
      [
        day("2026-08-17", 8, "SHIFT_DIFFERENTIAL"),
        ...["2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", saturday].map((d) => day(d, 8)),
      ],
      rules,
    );
    expect(review.totalHours).toBe(48);
    expect(review.weeklyUnresolved).toEqual([]);
    expect(review.weeklyThresholdApplied).toBe(true);
    expect(review.days[5].expected).toMatchObject({ STRAIGHT: 0, OVERTIME: 8 });
  });

  it("splits the excess when it straddles a shift-differential day", () => {
    // Mon-Fri 8 straight, Saturday 4 shift-differential, Sunday 8 straight
    // = 52 hours, 12 past the threshold. Sunday's eight are judgeable and
    // become overtime; Saturday's four crossed the line on hours this
    // review cannot judge, and are reported as such rather than dropped.
    const review = reviewDays(
      [
        ...monToFri.map((d) => day(d, 8)),
        day(saturday, 4, "SHIFT_DIFFERENTIAL"),
        day("2026-08-23", 8),
      ],
      rules,
    );
    expect(review.totalHours).toBe(52);
    expect(review.days[6].expected).toMatchObject({ STRAIGHT: 0, OVERTIME: 8 });
    expect(review.weeklyUnresolved).toEqual([{ date: saturday, hours: 4 }]);
  });

  it("says nothing about a shift-differential week that never reaches the threshold", () => {
    // Four days straight, one shift-differential: 40 hours exactly. No
    // excess, nothing unresolved, and no warning to cry wolf with.
    const review = reviewDays(
      [...monToFri.slice(0, 4).map((d) => day(d, 8)), day("2026-08-21", 8, "SHIFT_DIFFERENTIAL")],
      rules,
    );
    expect(review.totalHours).toBe(40);
    expect(review.weeklyUnresolved).toEqual([]);
    expect(review.disagreements).toEqual([]);
  });
});

describe("the verdict the page prints", () => {
  // These two exist so the green sentence is something a test can execute.
  // It used to be `disagreements.length === 0` written inline in JSX, and
  // that condition is TRUE of the 48-hour week above — a week owing eight
  // hours of overtime premium was told "Every day matches what the rules
  // imply." on the screen built to prevent exactly that finding.
  const rules = ruleSet({ dailyOvertimeAfterHours: 8, weeklyOvertimeAfterHours: 40 });
  const week = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"];

  it("is clean for a week that really is", () => {
    const review = reviewDays(week.map((d) => day(d, 8)), rules);
    expect(reviewIsClean(review)).toBe(true);
    expect(weeklyUnresolvedSentence(review)).toBeNull();
  });

  it("is NOT clean when the weekly overtime landed on unjudgeable hours", () => {
    const review = reviewDays(
      [...week.map((d) => day(d, 8)), day("2026-08-22", 8, "SHIFT_DIFFERENTIAL")],
      rules,
    );
    expect(review.disagreements).toEqual([]); // nothing to list…
    expect(reviewIsClean(review)).toBe(false); // …and still not clean.
    const sentence = weeklyUnresolvedSentence(review) as string;
    expect(sentence).toContain("8 hours past the weekly overtime threshold");
    expect(sentence).toContain("2026-08-22");
    expect(sentence).toContain("check them by hand");
  });

  it("is never clean when there was nothing to check against", () => {
    // An unchecked week has no disagreements either, and "no disagreements"
    // must not read as agreement anywhere.
    const review = reviewDays([day("2026-08-17", 10)], null);
    expect(review.disagreements).toEqual([]);
    expect(reviewIsClean(review)).toBe(false);
  });

  it("prints hours a payroll clerk believes, not a float sum", () => {
    // COMPOSES WITH #408 rather than sitting beside it. Two
    // shift-differential days of 0.1 and 4.1 hours: 4.199999999999999 in
    // JavaScript, which is exactly the figure that printed on the
    // certified-payroll page (`lib/render-hours.ts` header) — on the one
    // screen whose purpose is to be believed by somebody filing with a
    // government agency. Reachable here, so it is pinned here.
    const review = reviewDays(
      [
        ...week.map((d) => day(d, 8)),
        day("2026-08-22", 0.1, "SHIFT_DIFFERENTIAL"),
        day("2026-08-23", 4.1, "SHIFT_DIFFERENTIAL"),
      ],
      rules,
    );
    // The raw sum really is dusty — assert that, so this test cannot pass
    // because the arithmetic quietly stopped producing the case.
    const raw = review.weeklyUnresolved.reduce((sum, row) => sum + row.hours, 0);
    expect(String(raw)).toBe("4.199999999999999");
    expect(weeklyUnresolvedSentence(review)).toContain("4.2 hours past");
    expect(weeklyUnresolvedSentence(review)).not.toContain("4.199");
  });

  it("says one HOUR, singular, when that is what it is", () => {
    const review = reviewDays(
      [...week.map((d) => day(d, 8)), day("2026-08-22", 1, "SHIFT_DIFFERENTIAL")],
      rules,
    );
    expect(weeklyUnresolvedSentence(review)).toContain("1 hour past");
  });

  it("names every unjudgeable day the excess reached", () => {
    // Two shift-differential days at the end of a long week: 4 + 8 = 12
    // hours past forty, and the sentence has to name both or a clerk
    // checks one and signs.
    const review = reviewDays(
      [
        ...week.map((d) => day(d, 8)),
        day("2026-08-22", 4, "SHIFT_DIFFERENTIAL"),
        day("2026-08-23", 8, "SHIFT_DIFFERENTIAL"),
      ],
      rules,
    );
    expect(review.weeklyUnresolved).toEqual([
      { date: "2026-08-22", hours: 4 },
      { date: "2026-08-23", hours: 8 },
    ]);
    const sentence = weeklyUnresolvedSentence(review) as string;
    expect(sentence).toContain("12 hours");
    expect(sentence).toContain("2026-08-22 and 2026-08-23");
  });
});
