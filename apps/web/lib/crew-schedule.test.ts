import { describe, expect, it } from "vitest";
import {
  blocksImplicitSubmit,
  CrewScheduleInputError,
  dayKey,
  isPastDay,
  resolveWeekStart,
  schedulableJobs,
  scheduleDays,
  scheduleSavedMessage,
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

/* ------------------------------------------------- week board + bulk add */

describe("which week the board shows", () => {
  // 2026-10-11 is a Sunday: the week holding it began Monday Oct 5, and
  // "today" must be inside the range shown (ux medium-B #12).
  it("defaults to the Monday of the week holding today, today included", () => {
    expect(resolveWeekStart(undefined, "2026-10-11")).toBe("2026-10-05");
    expect(resolveWeekStart(undefined, "2026-10-12")).toBe("2026-10-12");
  });

  it("snaps any day of a ?week= to its Monday and ignores junk", () => {
    expect(resolveWeekStart("2026-10-21", "2026-10-11")).toBe("2026-10-19");
    expect(resolveWeekStart("2026-02-30", "2026-10-11")).toBe("2026-10-05");
    expect(resolveWeekStart("next week", "2026-10-11")).toBe("2026-10-05");
  });
});

describe("the days a bulk add covers", () => {
  it("skips Saturday and Sunday in a range when asked", () => {
    expect(scheduleDays("2026-10-16", "2026-10-20", true)).toEqual(["2026-10-16", "2026-10-19", "2026-10-20"]);
    expect(scheduleDays("2026-10-16", "2026-10-20", false)).toHaveLength(5);
  });

  it("keeps a single weekend day somebody picked on purpose", () => {
    expect(scheduleDays("2026-10-17", "2026-10-17", true)).toEqual(["2026-10-17"]);
  });

  it("refuses a backwards or runaway range in words", () => {
    expect(() => scheduleDays("2026-10-20", "2026-10-16", true)).toThrow(CrewScheduleInputError);
    expect(() => scheduleDays("2026-01-01", "2026-12-31", false)).toThrow(/62 days or less/);
  });
});

describe("the jobs the schedule form offers", () => {
  it("leaves out COMPLETE jobs and keeps everything else", () => {
    const jobs = [
      { id: "a", status: "COMPLETE" },
      { id: "b", status: "IN_PROGRESS" },
      { id: "c", status: "ESTIMATE" },
      { id: "d", status: null },
    ];
    expect(schedulableJobs(jobs).map((j) => j.id)).toEqual(["b", "c", "d"]);
  });
});

describe("Enter in the schedule form", () => {
  it("does not submit from a select, an input or a checkbox — only the button submits", () => {
    expect(blocksImplicitSubmit("Enter", "SELECT")).toBe(true);
    expect(blocksImplicitSubmit("Enter", "INPUT")).toBe(true);
    expect(blocksImplicitSubmit("Enter", "BUTTON")).toBe(false);
    expect(blocksImplicitSubmit("Enter", "TEXTAREA")).toBe(false);
    expect(blocksImplicitSubmit("ArrowDown", "SELECT")).toBe(false);
  });
});

describe("what a save says", () => {
  it("names the person, the job and the day for one row", () => {
    expect(
      scheduleSavedMessage({ workers: ["Hector Ramirez"], jobName: "Lakeview", days: ["2026-10-19"], created: 1, clashes: [] }),
    ).toBe("Hector Ramirez on Lakeview, Mon, Oct 19 — saved.");
  });

  it("counts new rows and rows that were already there, rather than refusing", () => {
    const message = scheduleSavedMessage({
      workers: ["Hector", "Luis"],
      jobName: "Lakeview",
      days: ["2026-10-19", "2026-10-20", "2026-10-21"],
      created: 4,
      clashes: [],
    });
    expect(message).toBe("2 people on Lakeview, Mon, Oct 19 – Wed, Oct 21 — saved (4 added, 2 already there).");
  });

  it("says nothing new was saved when every row existed", () => {
    expect(
      scheduleSavedMessage({ workers: ["Hector"], jobName: "Lakeview", days: ["2026-10-19"], created: 0, clashes: [] }),
    ).toBe("Hector already on Lakeview, Mon, Oct 19 — nothing new to save.");
  });

  it("warns, naming person, other job and day, when somebody is double-booked", () => {
    const message = scheduleSavedMessage({
      workers: ["Hector"],
      jobName: "Lakeview",
      days: ["2026-10-19"],
      created: 1,
      clashes: [{ worker: "Hector", jobName: "Riverside", day: "2026-10-19" }],
    });
    expect(message).toContain("saved.");
    expect(message).toContain("Double-booked: Hector is also on Riverside Mon, Oct 19.");
  });
});
