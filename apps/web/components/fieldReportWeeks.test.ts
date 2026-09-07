import { describe, expect, it } from "vitest";
import {
  type ReportData,
  addDays,
  daysBetween,
  groupIntoWeeks,
  isWeekend,
  missingWorkdays,
  weekDates,
  weekStart,
  weekSummaryText,
  weekdayIndex,
} from "@/components/fieldReportWeeks";

// 2026-08-31 is a Monday; the week runs Mon 31 Aug – Sun 6 Sep 2026.
const MON = "2026-08-31";
const TUE = "2026-09-01";
const WED = "2026-09-02";
const THU = "2026-09-03";
const FRI = "2026-09-04";
const SAT = "2026-09-05";
const SUN = "2026-09-06";

let seq = 0;
function report(partial: Partial<ReportData> = {}): ReportData {
  seq += 1;
  return {
    id: `r${seq}`,
    jobId: "j1",
    jobName: "Maple St Tower",
    reportDate: MON,
    crewPresent: "4 framers",
    workPerformed: "Layout and track on level 3",
    weather: null,
    delays: null,
    filedByName: "Cyrus",
    ...partial,
  };
}

describe("weekdayIndex", () => {
  it("counts Monday as the first day of the week", () => {
    expect(weekdayIndex(MON)).toBe(0);
    expect(weekdayIndex(FRI)).toBe(4);
  });

  it("counts Sunday as the LAST day, not the first", () => {
    // getUTCDay() calls Sunday 0. Using it raw would start a new week on
    // Sunday, stranding Sunday's report in a week that hadn't begun.
    expect(weekdayIndex(SAT)).toBe(5);
    expect(weekdayIndex(SUN)).toBe(6);
  });
});

describe("weekStart", () => {
  it("is the Monday of that week", () => {
    expect(weekStart(WED)).toBe(MON);
    expect(weekStart(MON)).toBe(MON);
  });

  it("keeps Sunday in the week that started the previous Monday", () => {
    expect(weekStart(SUN)).toBe(MON);
  });

  it("rolls back across a month boundary", () => {
    expect(weekStart(TUE)).toBe(MON); // Sep 1 belongs to the week starting Aug 31
  });
});

describe("isWeekend", () => {
  it("is Saturday and Sunday only", () => {
    expect(isWeekend(FRI)).toBe(false);
    expect(isWeekend(SAT)).toBe(true);
    expect(isWeekend(SUN)).toBe(true);
    expect(isWeekend(MON)).toBe(false);
  });
});

describe("weekDates", () => {
  it("is seven days, Monday through Sunday", () => {
    expect(weekDates(MON)).toEqual([MON, TUE, WED, THU, FRI, SAT, SUN]);
  });
});

describe("missingWorkdays", () => {
  it("names a finished weekday with nothing filed", () => {
    // Filed Mon and Wed; today is Thursday, so Tuesday is a real hole.
    expect(missingWorkdays([MON, WED], MON, THU)).toEqual([TUE]);
  });

  it("never flags a day that hasn't happened", () => {
    // On Wednesday, Thursday and Friday are not holes in the record.
    expect(missingWorkdays([MON, TUE], MON, WED)).toEqual([]);
  });

  it("never flags TODAY — the day is not over", () => {
    // Nothing filed today, and that is not yet a failure.
    expect(missingWorkdays([MON, TUE], MON, WED)).not.toContain(WED);
  });

  it("never flags a weekend nobody owed a report for", () => {
    // Today is the following Monday, so the whole week is finished.
    expect(missingWorkdays([MON, TUE, WED, THU, FRI], MON, "2026-09-07")).toEqual([]);
  });

  it("still counts a weekend report as work, without ever demanding one", () => {
    const week = groupIntoWeeks([report({ reportDate: SAT })], "2026-09-07")[0];
    expect(week.reports).toHaveLength(1);
    expect(week.missing).not.toContain(SAT);
  });

  it("reports every hole in a finished week, in order", () => {
    expect(missingWorkdays([WED], MON, "2026-09-07")).toEqual([MON, TUE, THU, FRI]);
  });
});

describe("groupIntoWeeks", () => {
  it("groups by Monday and puts the newest week first", () => {
    const thisWeek = report({ reportDate: WED });
    const lastWeek = report({ reportDate: "2026-08-26" }); // previous Wednesday
    const weeks = groupIntoWeeks([lastWeek, thisWeek], "2026-09-07");
    expect(weeks.map((w) => w.start)).toEqual([MON, "2026-08-24"]);
  });

  it("puts the newest day first inside a week", () => {
    const weeks = groupIntoWeeks(
      [report({ reportDate: MON }), report({ reportDate: THU })],
      "2026-09-07",
    );
    expect(weeks[0].reports.map((r) => r.reportDate)).toEqual([THU, MON]);
  });

  it("breaks a same-day tie on id so the order is total and stable", () => {
    const a = report({ id: "ra", reportDate: MON, jobId: "j1" });
    const b = report({ id: "rb", reportDate: MON, jobId: "j2" });
    expect(groupIntoWeeks([a, b], "2026-09-07")[0].reports.map((r) => r.id)).toEqual(["rb", "ra"]);
    expect(groupIntoWeeks([b, a], "2026-09-07")[0].reports.map((r) => r.id)).toEqual(["rb", "ra"]);
  });

  it("computes coverage over finished weekdays only", () => {
    // Today is Thursday: Mon/Tue/Wed are over. Two of three filed.
    const weeks = groupIntoWeeks(
      [report({ reportDate: MON }), report({ reportDate: WED })],
      THU,
    );
    expect(weeks[0].coveragePercent).toBe(67);
  });

  it("is 100% when every finished weekday is filed", () => {
    const weeks = groupIntoWeeks(
      [report({ reportDate: MON }), report({ reportDate: TUE })],
      WED,
    );
    expect(weeks[0].coveragePercent).toBe(100);
  });

  it("has no coverage figure before any weekday of the week is over", () => {
    // Monday morning. Rendering 0% would call a week nobody has worked yet
    // a failure.
    const weeks = groupIntoWeeks([report({ reportDate: MON })], MON);
    expect(weeks[0].coveragePercent).toBeNull();
  });

  it("counts a day as covered once, however many jobs reported it", () => {
    const weeks = groupIntoWeeks(
      [
        report({ reportDate: MON, jobId: "j1" }),
        report({ reportDate: MON, jobId: "j2" }),
      ],
      TUE,
    );
    // One finished weekday, filed. Two reports must not read as 200%.
    expect(weeks[0].coveragePercent).toBe(100);
  });

  it("collects the days that cost time", () => {
    const weeks = groupIntoWeeks(
      [
        report({ reportDate: MON, delays: "Board delivery 3h late" }),
        report({ reportDate: TUE, delays: null }),
        report({ reportDate: WED, delays: "   " }),
      ],
      THU,
    );
    expect(weeks[0].delayDays).toHaveLength(1);
    expect(weeks[0].delayDays[0].delays).toBe("Board delivery 3h late");
  });
});

describe("weekSummaryText", () => {
  const build = (reports: ReportData[], today: string) =>
    weekSummaryText(groupIntoWeeks(reports, today)[0], "Maple St Tower");

  it("names the job and the week", () => {
    const text = build([report({ reportDate: MON })], TUE);
    expect(text).toContain("Maple St Tower");
    expect(text).toContain("Aug 31");
  });

  it("writes out crew, work, weather and delays", () => {
    const text = build(
      [
        report({
          reportDate: MON,
          crewPresent: "4 framers, 2 apprentices",
          workPerformed: "Track and layout, level 3",
          weather: "Rain until noon",
          delays: "Hoist down 2h",
        }),
      ],
      TUE,
    );
    expect(text).toContain("4 framers, 2 apprentices");
    expect(text).toContain("Track and layout, level 3");
    expect(text).toContain("Rain until noon");
    expect(text).toContain("Hoist down 2h");
  });

  it("NAMES a missing day instead of quietly leaving it out", () => {
    // A summary that lists only the days that exist reads as a complete
    // week. Sending a GC a document that overstates our own record is
    // worse than one with a visible hole.
    const text = build([report({ reportDate: MON })], WED);
    expect(text).toContain("No report filed.");
    expect(text).toContain("Days with no report");
  });

  it("separates missing days with something other than a comma", () => {
    // Every day label already contains a comma ("Mon, Aug 24"), so a
    // comma-joined list reads as twice as many days as it names — on a
    // document that goes to a GC.
    const text = build([report({ reportDate: WED })], "2026-09-07");
    expect(text).toContain("Mon, Aug 31 · Tue, Sep 1");
  });

  it("says nothing about missing days when the week is complete so far", () => {
    const text = build([report({ reportDate: MON }), report({ reportDate: TUE })], WED);
    expect(text).not.toContain("No report filed.");
    expect(text).not.toContain("Days with no report");
  });

  it("does not invent holes for days that haven't happened", () => {
    const text = build([report({ reportDate: MON })], TUE);
    expect(text).not.toContain("No report filed.");
  });
});

describe("date helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("counts whole days, unaffected by daylight saving", () => {
    // US DST ends 1 Nov 2026; a naive local-time subtraction drifts here.
    expect(daysBetween("2026-10-15", "2026-11-14")).toBe(30);
  });
});

// The truncation finding. /field-reports loads the newest N reports and
// groups what came back, so the cut lands mid-week — and every filed
// report older than the cut was named as a day nobody filed. The page
// exists to argue schedule disputes, so a fabricated hole in your own
// record is the specific harm.
describe("a truncated set of reports", () => {
  const NEXT_MON = "2026-09-07";

  it("does not name a day as unfiled when it was never loaded", () => {
    // Only Thursday and Friday came back; the query cut off during
    // Wednesday, so completeness starts Thursday.
    expect(missingWorkdays([THU, FRI], MON, NEXT_MON, THU)).toEqual([]);
  });

  it("still names a hole INSIDE the part that was loaded", () => {
    // Complete from Tuesday: Wednesday is a real, knowable hole; Monday is
    // not, because Monday was never loaded.
    expect(missingWorkdays([TUE, THU, FRI], MON, NEXT_MON, TUE)).toEqual([WED]);
  });

  it("marks the cut-off week partial and refuses to score its coverage", () => {
    const week = groupIntoWeeks([report({ reportDate: THU }), report({ reportDate: FRI })], NEXT_MON, THU)[0];
    expect(week.partial).toBe(true);
    expect(week.missing).toEqual([]);
    // 2 of 5 finished weekdays would read as 40% "covered" for a week we
    // only loaded two days of.
    expect(week.coveragePercent).toBeNull();
  });

  it("leaves a fully loaded week alone", () => {
    const week = groupIntoWeeks([report({ reportDate: THU }), report({ reportDate: FRI })], NEXT_MON)[0];
    expect(week.partial).toBe(false);
    expect(week.missing).toEqual([MON, TUE, WED]);
    expect(week.coveragePercent).toBe(40);
  });

  // A week that starts after the cut is fully known even on a truncated
  // page — only the week straddling the cut is partial.
  it("does not mark a later week partial", () => {
    const weeks = groupIntoWeeks(
      [report({ reportDate: "2026-09-08" }), report({ reportDate: FRI })],
      "2026-09-10",
      FRI,
    );
    expect(weeks[0].start).toBe(NEXT_MON);
    expect(weeks[0].partial).toBe(false);
    expect(weeks[1].partial).toBe(true);
  });

  it("says so in the summary handed to a GC", () => {
    const week = groupIntoWeeks(
      [report({ reportDate: THU }), report({ reportDate: FRI })],
      NEXT_MON,
      THU,
    )[0];
    const text = weekSummaryText(week, "Maple St Tower");
    expect(text).toContain("outside the records loaded here");
    // Mon–Wed were never loaded, so the summary must not tell a GC that
    // nothing was filed on them.
    expect(text).not.toContain("No report filed.");
  });
});
