import { describe, expect, it } from "vitest";
import { hoursWeekStart, weeklyHours, type HoursEntry } from "./weekly-hours";

const e = (date: string, hours: number, personId: string, jobId: string): HoursEntry => ({
  date,
  hours,
  personId,
  personName: personId === "u1" ? "Ana" : "Ben",
  jobId,
  jobName: jobId === "j1" ? "Tower" : "School",
});

describe("weeklyHours", () => {
  it("totals by person, by day and by job, and drops entries outside the week", () => {
    // 2026-10-12 is a Monday; 10-18 the Sunday that closes the week.
    const week = weeklyHours(
      [
        e("2026-10-12", 8, "u1", "j1"),
        e("2026-10-12", 7.5, "u2", "j2"),
        e("2026-10-13", 8, "u1", "j2"),
        e("2026-10-18", 4, "u2", "j1"),
        e("2026-10-11", 9, "u1", "j1"), // Sunday before: last week
        e("2026-10-19", 9, "u1", "j1"), // Monday after: next week
      ],
      "2026-10-12",
    );
    expect(week.days[0]).toBe("2026-10-12");
    expect(week.days[6]).toBe("2026-10-18");
    expect(week.people).toEqual([
      { id: "u1", name: "Ana", dayHours: [8, 8, 0, 0, 0, 0, 0], totalHours: 16 },
      { id: "u2", name: "Ben", dayHours: [7.5, 0, 0, 0, 0, 0, 4], totalHours: 11.5 },
    ]);
    expect(week.dayHours).toEqual([15.5, 8, 0, 0, 0, 0, 4]);
    expect(week.jobs).toEqual([
      { id: "j2", name: "School", totalHours: 15.5 },
      { id: "j1", name: "Tower", totalHours: 12 },
    ]);
    expect(week.totalHours).toBe(27.5);
  });
});

describe("hoursWeekStart", () => {
  it("backs any day up to its Monday, and falls back to today's week on a bad value", () => {
    expect(hoursWeekStart("2026-10-18", "2026-01-01")).toBe("2026-10-12"); // Sunday -> its Monday
    expect(hoursWeekStart("2026-10-12", "2026-01-01")).toBe("2026-10-12");
    expect(hoursWeekStart(undefined, "2026-10-15")).toBe("2026-10-12");
    expect(hoursWeekStart("2026-02-31", "2026-10-15")).toBe("2026-10-12");
    expect(hoursWeekStart("garbage", "2026-10-15")).toBe("2026-10-12");
  });
});
