import { describe, expect, it } from "vitest";
import {
  CrewScheduleInputError,
  dayKey,
  isPastDay,
  plannedWithNoHours,
  timeEntryWorkerKey,
  workDateFromString,
  workerKey,
} from "./crew-schedule";

/**
 * The two questions this model exists to answer, and the several ways the
 * obvious implementation answers them wrongly.
 */

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const TINO = { scheduledUserId: "u-tino", crewMemberId: null };
const MARCO = { scheduledUserId: null, crewMemberId: "c-marco" };

describe("which worker a row names", () => {
  it("keys a User and a crew member into the same namespace, distinctly", () => {
    expect(workerKey(TINO)).toBe("user:u-tino");
    expect(workerKey(MARCO)).toBe("crew:c-marco");
    expect(workerKey(TINO)).not.toBe(workerKey(MARCO));
  });

  it("gives a TimeEntry the SAME key off differently-named columns", () => {
    // The two tables genuinely name these columns differently. If these two
    // functions ever disagree, every crew member's hours stop matching
    // their plan and the page reports the whole no-login crew as missing.
    expect(timeEntryWorkerKey({ employeeUserId: "u-tino", crewMemberId: null })).toBe(workerKey(TINO));
    expect(timeEntryWorkerKey({ employeeUserId: null, crewMemberId: "c-marco" })).toBe(workerKey(MARCO));
  });

  it("does not collide a user id with a crew id of the same string", () => {
    // Both are cuids from different tables and nothing stops them matching.
    expect(workerKey({ scheduledUserId: "x1", crewMemberId: null })).not.toBe(
      workerKey({ scheduledUserId: null, crewMemberId: "x1" }),
    );
  });
});

describe("the date a plan is for", () => {
  it("is UTC midnight, so a day is a calendar day", () => {
    expect(workDateFromString("2026-09-21").toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  it("refuses an empty or unreadable date rather than defaulting to today", () => {
    // A schedule defaulting to today is a plan nobody made.
    expect(() => workDateFromString("")).toThrow(CrewScheduleInputError);
    expect(() => workDateFromString("   ")).toThrow(CrewScheduleInputError);
    expect(() => workDateFromString("next tuesday")).toThrow(CrewScheduleInputError);
    expect(() => workDateFromString(undefined)).toThrow(CrewScheduleInputError);
  });

  it("refuses a date that does not exist, rather than rolling it into next month", () => {
    // `new Date("2026-02-30T00:00:00Z")` is NOT invalid — it is 2 March.
    // Without a round trip, a typo in the day put a man on the schedule for
    // a different day than anybody chose, and nothing said so.
    for (const impossible of ["2026-02-30", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-09-00"]) {
      expect(() => workDateFromString(impossible), impossible).toThrow(CrewScheduleInputError);
    }
    // Leap day in a leap year is a real day.
    expect(workDateFromString("2028-02-29").toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("refuses anything that is not a plain YYYY-MM-DD day", () => {
    // A timestamp would parse, and would quietly carry a time into a
    // column that means a calendar day.
    expect(() => workDateFromString("2026-09-21T15:00:00Z")).toThrow(CrewScheduleInputError);
    expect(() => workDateFromString("2026-9-21")).toThrow(CrewScheduleInputError);
  });
});

describe("planned days nobody logged an hour against", () => {
  const planned = [
    { jobId: "job-riverside", workDate: day("2026-09-14"), ...TINO },
    { jobId: "job-riverside", workDate: day("2026-09-15"), ...TINO },
    { jobId: "job-riverside", workDate: day("2026-09-14"), ...MARCO },
  ];

  it("clears a plan the hours cover", () => {
    const missing = plannedWithNoHours(planned, [
      { jobId: "job-riverside", date: day("2026-09-14"), employeeUserId: "u-tino", crewMemberId: null },
    ]);
    expect(missing.map((d) => `${workerKey(d)}@${dayKey(d.workDate)}`)).toEqual([
      "user:u-tino@2026-09-15",
      "crew:c-marco@2026-09-14",
    ]);
  });

  it("MATCHES A CREW MEMBER'S HOURS, not just a User's", () => {
    // The whole reason the XOR is on this table. A schedule that only
    // cleared User rows would report every no-login worker as missing
    // every single day — which for a union sub is most of the field, and
    // the page would be abandoned in a week.
    const missing = plannedWithNoHours(planned, [
      { jobId: "job-riverside", date: day("2026-09-14"), employeeUserId: null, crewMemberId: "c-marco" },
    ]);
    expect(missing.some((d) => d.crewMemberId === "c-marco")).toBe(false);
  });

  it("does NOT let hours on another job satisfy the plan", () => {
    // The finding, and the case somebody is actually looking for: a man
    // moved to a different site. Matching on worker and date alone hides
    // exactly that, and it is the reason the key carries the job.
    const missing = plannedWithNoHours(planned, [
      { jobId: "job-cedar", date: day("2026-09-14"), employeeUserId: "u-tino", crewMemberId: null },
    ]);
    expect(missing.map((d) => `${workerKey(d)}@${dayKey(d.workDate)}`)).toContain("user:u-tino@2026-09-14");
    expect(missing).toHaveLength(3);
  });

  it("does not let hours on another DAY satisfy the plan", () => {
    const missing = plannedWithNoHours(planned, [
      { jobId: "job-riverside", date: day("2026-09-16"), employeeUserId: "u-tino", crewMemberId: null },
    ]);
    expect(missing).toHaveLength(3);
  });

  it("returns nothing when every plan was worked", () => {
    // The control. A function that returned everything would pass three of
    // the tests above.
    const missing = plannedWithNoHours(planned, [
      { jobId: "job-riverside", date: day("2026-09-14"), employeeUserId: "u-tino", crewMemberId: null },
      { jobId: "job-riverside", date: day("2026-09-15"), employeeUserId: "u-tino", crewMemberId: null },
      { jobId: "job-riverside", date: day("2026-09-14"), employeeUserId: null, crewMemberId: "c-marco" },
    ]);
    expect(missing).toEqual([]);
  });

  it("reports nothing missing when nothing was planned, rather than everything", () => {
    expect(plannedWithNoHours([], [])).toEqual([]);
  });
});

describe("which days can be missing hours at all", () => {
  const today = "2026-09-17";

  it("does not flag today or a future plan", () => {
    // Hours for today are logged at the end of today. A page that flagged
    // this morning's plan would cry wolf every morning until people stopped
    // reading it.
    expect(isPastDay(day("2026-09-17"), today)).toBe(false);
    expect(isPastDay(day("2026-09-18"), today)).toBe(false);
  });

  it("flags yesterday", () => {
    expect(isPastDay(day("2026-09-16"), today)).toBe(true);
  });
});
