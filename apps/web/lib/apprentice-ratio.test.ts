import { describe, expect, it } from "vitest";
import {
  ratioLabel,
  reviewRatioByDay,
  summarizeRatio,
  type RatioEntryInput,
  type RatioRuleInput,
} from "./apprentice-ratio";

const rule: RatioRuleInput = {
  apprenticeCount: 1,
  journeymenCount: 3,
  programStandardReference: null,
};

const entry = (
  date: string,
  hours: number,
  tier: RatioEntryInput["tier"],
  employeeName = "Someone",
): RatioEntryInput => ({ date, hours, tier, employeeName });

describe("reviewRatioByDay", () => {
  it("passes a day inside the ratio", () => {
    // 24 journeyman hours allow 8 apprentice hours at 1:3.
    const [day] = reviewRatioByDay(
      [
        entry("2026-08-17", 8, "JOURNEYMAN"),
        entry("2026-08-17", 8, "JOURNEYMAN"),
        entry("2026-08-17", 8, "JOURNEYMAN"),
        entry("2026-08-17", 8, "APPRENTICE"),
      ],
      rule,
    );
    expect(day.allowedApprenticeHours).toBe(8);
    expect(day.status).toBe("WITHIN");
    expect(day.excessApprenticeHours).toBe(0);
  });

  it("flags the day it goes over, with how far", () => {
    const [day] = reviewRatioByDay(
      [entry("2026-08-17", 8, "JOURNEYMAN"), entry("2026-08-17", 8, "APPRENTICE")],
      rule,
    );
    // 8 journeyman hours allow 2.67 apprentice hours.
    expect(day.allowedApprenticeHours).toBe(2.67);
    expect(day.status).toBe("OVER");
    expect(day.excessApprenticeHours).toBe(5.33);
  });

  it("counts a foreman on the journeyman side", () => {
    const [day] = reviewRatioByDay(
      [entry("2026-08-17", 24, "FOREMAN"), entry("2026-08-17", 8, "APPRENTICE")],
      rule,
    );
    expect(day.journeymanHours).toBe(24);
    expect(day.status).toBe("WITHIN");
  });

  it("calls out an apprentice on site with no journeyman at all", () => {
    // The fix is different — you need a journeyman there, not fewer
    // apprentice hours — so it gets its own status.
    const [day] = reviewRatioByDay([entry("2026-08-17", 8, "APPRENTICE")], rule);
    expect(day.status).toBe("NO_JOURNEYMAN");
    expect(day.excessApprenticeHours).toBe(8);
  });

  it("is not applicable on a day no apprentice worked", () => {
    const [day] = reviewRatioByDay([entry("2026-08-17", 8, "JOURNEYMAN")], rule);
    expect(day.status).toBe("NOT_APPLICABLE");
  });

  it("never lets unclassified hours count as journeyman hours", () => {
    // The most dangerous failure available here: a job looking compliant
    // because nobody finished tagging its crafts.
    const [day] = reviewRatioByDay(
      [entry("2026-08-17", 24, null, "Unknown Craft"), entry("2026-08-17", 8, "APPRENTICE")],
      rule,
    );
    expect(day.journeymanHours).toBe(0);
    expect(day.unclassifiedHours).toBe(24);
    expect(day.status).toBe("INCOMPLETE");
    expect(day.unclassifiedNames).toEqual(["Unknown Craft"]);
  });

  it("is incomplete rather than compliant when there is no rule to measure against", () => {
    const [day] = reviewRatioByDay(
      [entry("2026-08-17", 24, "JOURNEYMAN"), entry("2026-08-17", 8, "APPRENTICE")],
      null,
    );
    expect(day.allowedApprenticeHours).toBeNull();
    expect(day.status).toBe("INCOMPLETE");
  });

  it("does not divide by a zero journeymen count", () => {
    const [day] = reviewRatioByDay(
      [entry("2026-08-17", 8, "JOURNEYMAN"), entry("2026-08-17", 8, "APPRENTICE")],
      { apprenticeCount: 1, journeymenCount: 0, programStandardReference: null },
    );
    expect(day.allowedApprenticeHours).toBeNull();
    expect(day.status).toBe("INCOMPLETE");
  });

  it("judges each day on its own, never on a weekly average", () => {
    // Two apprentices to one journeyman on Monday and none the rest of
    // the week averages fine and is still a violation on Monday.
    const days = reviewRatioByDay(
      [
        entry("2026-08-17", 8, "JOURNEYMAN"),
        entry("2026-08-17", 16, "APPRENTICE"),
        entry("2026-08-18", 24, "JOURNEYMAN"),
        entry("2026-08-19", 24, "JOURNEYMAN"),
      ],
      rule,
    );
    expect(days.map((d) => d.status)).toEqual(["OVER", "NOT_APPLICABLE", "NOT_APPLICABLE"]);
  });

  it("returns days in date order whatever order the entries arrive in", () => {
    const days = reviewRatioByDay(
      [entry("2026-08-19", 8, "JOURNEYMAN"), entry("2026-08-17", 8, "JOURNEYMAN")],
      rule,
    );
    expect(days.map((d) => d.date)).toEqual(["2026-08-17", "2026-08-19"]);
  });
});

describe("summarizeRatio", () => {
  it("counts only the days the rule could bind on", () => {
    const days = reviewRatioByDay(
      [
        entry("2026-08-17", 8, "JOURNEYMAN"),
        entry("2026-08-18", 8, "JOURNEYMAN"),
        entry("2026-08-18", 8, "APPRENTICE"),
        entry("2026-08-19", 4, null),
      ],
      rule,
    );
    const summary = summarizeRatio(days);
    // Monday had no apprentice hours: not evidence of compliance, so not
    // counted as a day checked.
    expect(summary.daysChecked).toBe(2);
    expect(summary.daysOver).toBe(1);
    expect(summary.daysIncomplete).toBe(1);
    expect(summary.offendingDates).toEqual(["2026-08-18"]);
    expect(summary.worstExcessHours).toBe(5.33);
  });

  it("has nothing to say about an empty period", () => {
    expect(summarizeRatio([])).toMatchObject({ daysChecked: 0, daysOver: 0, worstExcessHours: 0 });
  });
});

describe("ratioLabel", () => {
  it("reads the way the rule is written", () => {
    expect(ratioLabel(rule)).toBe("1 apprentice per 3 journeymen");
    expect(
      ratioLabel({ apprenticeCount: 2, journeymenCount: 1, programStandardReference: null }),
    ).toBe("2 apprentices per 1 journeyman");
  });
});
