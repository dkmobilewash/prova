import { describe, expect, it } from "vitest";
import { CALENDAR_FEED_FUTURE_DAYS, CALENDAR_FEED_PAST_DAYS, crewScheduleEvents, type CalendarScheduleRow } from "@/lib/calendar-feed";

/**
 * `crewScheduleEvents` is pure — rows in, events out, no database — so the
 * grouping, wording and UID stability it promises are checked here without
 * a Prisma call. `loadCalendarSchedule`'s SCOPE (company-only, the window)
 * is exercised through the route test instead, where the token boundary
 * actually lives.
 */

function row(overrides: Partial<CalendarScheduleRow> = {}): CalendarScheduleRow {
  return {
    workDate: new Date("2026-09-22T00:00:00.000Z"),
    note: null,
    jobId: "job_1",
    job: { name: "Westfield Plaza", siteAddress: "500 Main St" },
    scheduledUser: { name: "Ana Ruiz", email: "ana@example.com" },
    crewMember: null,
    craftClassification: { name: "Finisher" },
    updatedAt: new Date("2026-09-19T00:00:00.000Z"),
    ...overrides,
  };
}

describe("crewScheduleEvents — grouping", () => {
  it("groups every worker on the same job and day into ONE event", () => {
    const rows = [
      row({ scheduledUser: { name: "Ana Ruiz", email: "a@x.com" } }),
      row({ scheduledUser: { name: "Ben Cole", email: "b@x.com" }, craftClassification: null }),
      row({ scheduledUser: { name: "Cy Diaz", email: "c@x.com" } }),
    ];
    const events = crewScheduleEvents(rows);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Westfield Plaza — Ana Ruiz (Finisher), Ben Cole, Cy Diaz (Finisher)");
  });

  it("emits a SEPARATE event for the same job on a different day, and for a different job on the same day", () => {
    const rows = [
      row({ jobId: "job_1", workDate: new Date("2026-09-22T00:00:00.000Z") }),
      row({ jobId: "job_1", workDate: new Date("2026-09-23T00:00:00.000Z") }),
      row({ jobId: "job_2", workDate: new Date("2026-09-22T00:00:00.000Z"), job: { name: "Alameda Tower", siteAddress: null } }),
    ];
    const events = crewScheduleEvents(rows);
    expect(events).toHaveLength(3);
  });

  it("joins each worker's own note, prefixed with their name, and omits workers with none", () => {
    const rows = [
      row({ scheduledUser: { name: "Ana Ruiz", email: "a@x.com" }, note: "bring the lift" }),
      row({ scheduledUser: { name: "Ben Cole", email: "b@x.com" }, note: null }),
    ];
    const events = crewScheduleEvents(rows);
    expect(events[0].description).toBe("Ana Ruiz: bring the lift");
  });

  it("description is null (not an empty string) when nobody left a note", () => {
    const events = crewScheduleEvents([row({ note: null })]);
    expect(events[0].description).toBeNull();
  });

  it("uses the job's site address as the location, or null when the job has none", () => {
    const withAddress = crewScheduleEvents([row()]);
    expect(withAddress[0].location).toBe("500 Main St");
    const without = crewScheduleEvents([row({ job: { name: "X", siteAddress: null } })]);
    expect(without[0].location).toBeNull();
  });

  it("falls back to the crew member's legal name when there is no scheduled user", () => {
    const events = crewScheduleEvents([
      row({
        scheduledUser: null,
        crewMember: { legalFirstName: "Dee", legalMiddleName: null, legalLastName: "Ford" },
      }),
    ]);
    expect(events[0].summary).toContain("Dee Ford");
  });

  it("sorts output deterministically by day then job name — unchanged input order still produces the same output", () => {
    const rows = [
      row({ jobId: "job_2", job: { name: "Zeta Job", siteAddress: null }, workDate: new Date("2026-09-22T00:00:00.000Z") }),
      row({ jobId: "job_1", job: { name: "Alpha Job", siteAddress: null }, workDate: new Date("2026-09-22T00:00:00.000Z") }),
      row({ jobId: "job_3", job: { name: "Beta Job", siteAddress: null }, workDate: new Date("2026-09-21T00:00:00.000Z") }),
    ];
    const forward = crewScheduleEvents(rows).map((e) => e.date + "/" + e.summary.split(" — ")[0]);
    const reversed = crewScheduleEvents([...rows].reverse()).map((e) => e.date + "/" + e.summary.split(" — ")[0]);
    expect(forward).toEqual(["2026-09-21/Beta Job", "2026-09-22/Alpha Job", "2026-09-22/Zeta Job"]);
    expect(forward).toEqual(reversed);
  });
});

describe("crewScheduleEvents — UID stability", () => {
  it("the same (job, day) always produces the same UID, whatever the crew or note", () => {
    const before = crewScheduleEvents([row({ note: "bring the lift" })])[0].uid;
    const after = crewScheduleEvents([
      row({ scheduledUser: { name: "Different Person", email: "d@x.com" }, note: "a whole new note" }),
    ])[0].uid;
    expect(before).toBe(after);
    expect(before).toBe("crew-job_1-20260922@cstream.ai");
  });

  it("a different job or a different day produces a different UID", () => {
    const jobA = crewScheduleEvents([row({ jobId: "job_1" })])[0].uid;
    const jobB = crewScheduleEvents([row({ jobId: "job_2" })])[0].uid;
    expect(jobA).not.toBe(jobB);
    const dayA = crewScheduleEvents([row({ workDate: new Date("2026-09-22T00:00:00Z") })])[0].uid;
    const dayB = crewScheduleEvents([row({ workDate: new Date("2026-09-23T00:00:00Z") })])[0].uid;
    expect(dayA).not.toBe(dayB);
  });

  it("updatedAt is the NEWEST row in the group, so a later edit moves the stamp", () => {
    const events = crewScheduleEvents([
      row({ scheduledUser: { name: "Ana", email: "a@x.com" }, updatedAt: new Date("2026-09-10T00:00:00Z") }),
      row({ scheduledUser: { name: "Ben", email: "b@x.com" }, updatedAt: new Date("2026-09-19T00:00:00Z") }),
    ]);
    expect(events[0].updatedAt.toISOString()).toBe("2026-09-19T00:00:00.000Z");
  });
});

describe("the feed window", () => {
  it("is 14 days each way, mirroring the board's own horizon forward and adding a trailing window backward", () => {
    expect(CALENDAR_FEED_PAST_DAYS).toBe(14);
    expect(CALENDAR_FEED_FUTURE_DAYS).toBe(14);
  });
});
