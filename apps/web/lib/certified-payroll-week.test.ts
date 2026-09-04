import { describe, expect, it } from "vitest";
import { certifiedPayrollWeekStart, certifiedPayrollWeekWindow } from "./certified-payroll-week";
import { buildCertifiedPayrollSummary, type CertifiedPayrollTimeEntryInput } from "./certified-payroll";
import type { FringeRateScheduleInput } from "./labor-cost";

/**
 * The window on a document filed under penalty.
 *
 * These hours go on a certified payroll. An eight-day window put every
 * Sunday's hours on TWO consecutive filings — the same hours and the same
 * dollars, certified twice, with no date printed anywhere on either page
 * to reveal which day they came from.
 */

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("certifiedPayrollWeekStart", () => {
  it("backs any day up to its Sunday, at UTC midnight", () => {
    for (const [day, sunday] of [
      ["2026-08-23", "2026-08-23"], // Sunday itself
      ["2026-08-24", "2026-08-23"], // Monday
      ["2026-08-29", "2026-08-23"], // Saturday
      ["2026-08-30", "2026-08-30"], // the next Sunday
    ] as const) {
      expect(certifiedPayrollWeekStart(utc(day)).toISOString()).toBe(`${sunday}T00:00:00.000Z`);
    }
  });
});

describe("certifiedPayrollWeekWindow", () => {
  it("ends on Saturday, not the following Sunday", () => {
    const w = certifiedPayrollWeekWindow(utc("2026-08-23"));
    expect(w.gte.toISOString()).toBe("2026-08-23T00:00:00.000Z");
    // The bug yielded 2026-08-30 — the NEXT week's Sunday.
    expect(w.lte.toISOString()).toBe("2026-08-29T00:00:00.000Z");
  });

  it("covers exactly seven days", () => {
    const w = certifiedPayrollWeekWindow(utc("2026-08-23"));
    expect((w.lte.getTime() - w.gte.getTime()) / 86_400_000).toBe(6);
  });

  it("consecutive weeks do not overlap — no day is certified twice", () => {
    // The property, not a magic date: weeks must PARTITION the calendar.
    // This also catches any future respelling of the bound.
    for (const sunday of ["2026-08-23", "2026-08-30", "2026-12-27", "2027-01-03"]) {
      const first = certifiedPayrollWeekWindow(utc(sunday));
      const second = certifiedPayrollWeekWindow(new Date(first.gte.getTime() + 7 * 86_400_000));
      expect(first.lte.getTime()).toBeLessThan(second.gte.getTime());
      // and no gap either: the day after Saturday is the next Sunday.
      expect(second.gte.getTime() - first.lte.getTime()).toBe(86_400_000);
    }
  });

  it("assigns every day of a year to exactly one of the year's weeks", () => {
    // Every Sunday of 2026 (plus the one before it and the one after), as
    // a real set of filings. A day must land inside exactly ONE of them —
    // asking each day only about its own week would pass under the bug,
    // because the bug does not move a day out of its week, it puts the day
    // into a SECOND one.
    const firstSunday = certifiedPayrollWeekWindow(new Date(Date.UTC(2025, 11, 25))).gte;
    const windows = Array.from({ length: 56 }, (_, i) =>
      certifiedPayrollWeekWindow(new Date(firstSunday.getTime() + i * 7 * 86_400_000)),
    );

    const offenders: string[] = [];
    for (let i = 0; i < 365; i++) {
      const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000);
      const containing = windows.filter(
        (w) => day.getTime() >= w.gte.getTime() && day.getTime() <= w.lte.getTime(),
      );
      if (containing.length !== 1) {
        offenders.push(`${day.toISOString().slice(0, 10)} in ${containing.length} weeks`);
      }
    }
    // Under the bug this lists all 52 Sundays: each is certified on its own
    // week and again on the week before.
    expect(offenders).toEqual([]);
  });
});

/**
 * The money, end to end, without a database.
 *
 * `buildCertifiedPayrollSummary` is pure, so the filed dollar figure can
 * be asserted here: the only thing between the rows and the total is the
 * window. Filtering with `>= gte && <= lte` is exactly what the Prisma
 * `date: { gte, lte }` clause in lib/certified-payroll-query.ts means.
 */
describe("the week of 2026-08-23, priced", () => {
  const CRAFT = "craft_carp405_jw";
  const schedules = new Map<string, FringeRateScheduleInput[]>([
    [
      CRAFT,
      [
        {
          baseWage: 52.0,
          pensionRate: 9.5,
          vacationRate: 3.25,
          healthWelfareRate: 11.75,
          trainingRate: 0.85,
          effectiveFrom: utc("2026-01-01"),
          effectiveTo: null,
        },
      ],
    ],
  ]);

  // Mon-Fri 8h straight, plus a SUNDAY makeup shift that belongs to the
  // NEXT week.
  const rows: { date: string; hours: number; payType: "STRAIGHT" | "OVERTIME" }[] = [
    { date: "2026-08-24", hours: 8, payType: "STRAIGHT" },
    { date: "2026-08-25", hours: 8, payType: "STRAIGHT" },
    { date: "2026-08-26", hours: 8, payType: "STRAIGHT" },
    { date: "2026-08-27", hours: 8, payType: "STRAIGHT" },
    { date: "2026-08-28", hours: 8, payType: "STRAIGHT" },
    { date: "2026-08-30", hours: 6, payType: "OVERTIME" },
  ];

  const entriesIn = (weekStart: string): CertifiedPayrollTimeEntryInput[] => {
    const { gte, lte } = certifiedPayrollWeekWindow(utc(weekStart));
    return rows
      .filter((r) => utc(r.date) >= gte && utc(r.date) <= lte)
      .map((r) => ({
        employeeUserId: "alice",
        employeeName: "Alice",
        craftClassificationId: CRAFT,
        craftLabel: "Carpenters 405 — Journeyman",
        date: utc(r.date),
        hours: r.hours,
        payType: r.payType,
        perDiemAmount: null,
        travelPayAmount: null,
      }));
  };

  it("reports 40 hours and $3,094.00, with an empty OT column", () => {
    const [alice] = buildCertifiedPayrollSummary(entriesIn("2026-08-23"), schedules);
    // The bug reported 46 hours, 6 of them overtime, and $3,714.10 — on a
    // week in which zero overtime was worked.
    expect(alice.totalHours).toBe(40);
    expect(alice.totalWageCost).toBeCloseTo(3094.0, 2);
    expect(alice.rows[0].hoursByPayType.OVERTIME).toBe(0);
  });

  it("certifies the Sunday's 6 hours and $620.10 on ONE week, not two", () => {
    const first = buildCertifiedPayrollSummary(entriesIn("2026-08-23"), schedules);
    const second = buildCertifiedPayrollSummary(entriesIn("2026-08-30"), schedules);
    const firstHours = first.reduce((s, e) => s + e.totalHours, 0);
    const secondHours = second.reduce((s, e) => s + e.totalHours, 0);
    // 46 + 6 under the bug: the same six hours filed twice.
    expect(firstHours + secondHours).toBe(46);
    expect(secondHours).toBe(6);
    expect(second[0].totalWageCost).toBeCloseTo(620.1, 2);
  });
});
