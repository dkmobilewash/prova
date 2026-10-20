import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/lib/permissions";

/**
 * who_would_know — the second half of the attendance refusal.
 *
 * What is pinned: every name in the result came from a ROW, and the result
 * says which row; the asker is marked so nobody offers to email them; a
 * crew member with no login is listed and marked unreachable rather than
 * dropped; a day that names nobody says so in `unavailable` rather than
 * returning an empty shape the model could narrate around; and the fake
 * HONOURS `companyId` on every table, so a handler that dropped it from any
 * one query returns the other company's foreman and goes red.
 *
 * What is NOT pinned here, and cannot be: what the model says with this.
 * The refusal sentence is the model's, under answer.ts's rule; CI runs with
 * no ANTHROPIC_API_KEY, so that sentence is only ever proved by a person
 * asking a deployment that has one.
 */

type Where = Record<string, unknown>;
function matches(row: Record<string, unknown>, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, want]) => {
    if (key === "OR") return (want as Where[]).some((branch) => matches(row, branch));
    const have = row[key];
    if (want instanceof Date) return have instanceof Date && have.getTime() === want.getTime();
    if (want !== null && typeof want === "object") {
      const op = want as { contains?: string; equals?: string; in?: unknown[] };
      if (op.contains !== undefined) return String(have ?? "").toLowerCase().includes(op.contains.toLowerCase());
      if (op.equals !== undefined) return String(have ?? "").toLowerCase() === op.equals.toLowerCase();
      if (op.in !== undefined) return op.in.includes(have);
      return false;
    }
    return have === want;
  });
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAY = "2026-09-25"; // a Friday; "last Tuesday" is 2026-09-22

const HECTOR = { id: "u-hector", name: "Hector Alvarez", email: "hector@example.test" };
const ME = { id: "u-me", name: "Cyrus Obiz", email: "cyrus@example.test" };
const OTHER = { id: "u-other", name: "Other Co Foreman", email: "leak@other.test" };

const BRACKETT = { name: "Brackett Construction" };
const JOBS = [
  { id: "j1", companyId: "co-1", name: "Riverside Medical Office Building", contactId: "c-brackett", contact: BRACKETT, assignments: [{ user: HECTOR }, { user: ME }] },
  { id: "j2", companyId: "co-1", name: "Northgate Apartments", contactId: "c-other-gc", contact: { name: "Other GC" }, assignments: [] },
  { id: "j9", companyId: "co-2", name: "Riverside Towers", contactId: "c-leak", contact: { name: "Leak" }, assignments: [{ user: OTHER }] },
];
const RAMIREZ = { legalFirstName: "Hector", legalMiddleName: null, legalLastName: "Ramirez", phone: "555-0100" };
const HOURS = [
  // The foreman: a crew member with no login, hours logged that day. TimeEntry
  // has no companyId; it is reached through the in-company job.
  { id: "t1", jobId: "j1", date: d("2026-09-22"), employeeUser: null, crewMember: RAMIREZ, createdAt: d("2026-09-22") },
  { id: "t2", jobId: "j1", date: d("2026-09-23"), employeeUser: HECTOR, crewMember: null, createdAt: d("2026-09-23") },
  { id: "t9", jobId: "j9", date: d("2026-09-22"), employeeUser: OTHER, crewMember: null, createdAt: d("2026-09-22") },
];
const PEOPLE = [
  { id: "p-marco", companyId: "co-1", contactId: "c-brackett", name: "Marco Silva", title: "Superintendent", email: "super@brackett.example", phone: null },
  { id: "p-dana", companyId: "co-1", contactId: "c-brackett", name: "Dana Whitfield", title: "PM", email: null, phone: "555-0200" },
  { id: "p-leak", companyId: "co-2", contactId: "c-brackett", name: "Leaky Person", title: "PM", email: "leak@other.test", phone: null },
];
const REPORTS = [
  { id: "r1", companyId: "co-1", jobId: "j1", reportDate: d("2026-09-22"), filedBy: HECTOR },
  { id: "r2", companyId: "co-1", jobId: "j1", reportDate: d("2026-09-24"), filedBy: ME },
  { id: "r9", companyId: "co-2", jobId: "j9", reportDate: d("2026-09-22"), filedBy: OTHER },
];
const CREW_TINO = { legalFirstName: "Tino", legalMiddleName: null, legalLastName: "Reyes", phone: "555-0100" };
const SCHEDULE = [
  { id: "s1", companyId: "co-1", jobId: "j1", workDate: d("2026-09-22"), scheduledUser: null, crewMember: CREW_TINO, createdAt: d("2026-09-20") },
  { id: "s2", companyId: "co-1", jobId: "j1", workDate: d("2026-09-22"), scheduledUser: HECTOR, crewMember: null, createdAt: d("2026-09-20") },
  { id: "s9", companyId: "co-2", jobId: "j9", workDate: d("2026-09-22"), scheduledUser: OTHER, crewMember: null, createdAt: d("2026-09-20") },
];

const calls = vi.hoisted(() => ({ job: [] as Where[], report: [] as Where[], schedule: [] as Where[], hours: [] as Where[], people: [] as Where[] }));
const served = (rows: Record<string, unknown>[], log: Where[]) => ({
  findMany: async ({ where, orderBy }: { where: Where; orderBy?: Record<string, string> | Record<string, string>[] }) => {
    log.push(where);
    const hits = rows.filter((row) => matches(row, where));
    // The real query orders the GC's people by name; honoured here so the
    // expectation below is about the handler, not about insertion order.
    if (!Array.isArray(orderBy) && orderBy?.name === "asc") hits.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return hits;
  },
  findFirst: async ({ where, orderBy }: { where: Where; orderBy?: Record<string, string> }) => {
    log.push(where);
    const hits = rows.filter((row) => matches(row, where));
    if (orderBy?.reportDate === "desc") hits.sort((a, b) => (b.reportDate as Date).getTime() - (a.reportDate as Date).getTime());
    return hits[0] ?? null;
  },
});

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    job: served(JOBS, calls.job),
    dailyFieldReport: served(REPORTS, calls.report),
    crewScheduleDay: served(SCHEDULE, calls.schedule),
    timeEntry: served(HOURS, calls.hours),
    contactPerson: served(PEOPLE, calls.people),
  },
}));
vi.mock("@/lib/serverToday", () => ({ serverToday: () => TODAY }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: async () => TODAY, viewerTimeZone: async () => "UTC" }));

const { runTool } = await import("./handlers");
const { TOOLS } = await import("./tools");

const OWNER: Principal = { role: "OWNER", jobFunction: null };
const actor = { companyId: "co-1", principal: OWNER, userId: "u-me" };

type Named = { name: string; email: string | null; canBeEmailed: boolean; isYou: boolean; source: string };
type Data = {
  job: string;
  day: string | null;
  attendanceIsRecorded: boolean;
  filedReport: { day: string; source: string; who: Named | null } | null;
  onScheduleThatDay: Named[];
  loggedHoursThatDay: Named[];
  assignedToJob: Named[];
  atTheGc: (Named & { title: string | null; at: string })[];
  gcPeopleWithheld: boolean;
};

beforeEach(() => {
  for (const log of Object.values(calls)) log.length = 0;
});

describe("who_would_know", () => {
  it("is offered on MANAGE_FIELD, the gate of the field-reports page it reads the filer from", () => {
    const tool = TOOLS.find((t) => t.name === "who_would_know")!;
    expect(tool.capability).toBe("MANAGE_FIELD");
    expect(Object.keys(tool.input_schema.properties).sort()).toEqual(["day", "jobName"]);
    expect(tool.description).toMatch(/canBeEmailed/);
    // The description says, in so many words, that this is not attendance.
    expect(tool.description).toMatch(/never who was there/i);
    expect(tool.description).toMatch(/does NOT record attendance/);
  });

  it("names the filer, the scheduled, the hours, the assigned and the GC's people for the day, each with its source, and says attendance is not recorded", async () => {
    const result = await runTool(actor, "who_would_know", { jobName: "Riverside", day: "last Tuesday" });
    expect(result.unavailable).toBeUndefined();
    const data = result.data as Data;
    expect(data.job).toBe("Riverside Medical Office Building");
    expect(data.day).toBe("2026-09-22");
    expect(data.attendanceIsRecorded).toBe(false);

    expect(data.filedReport?.day).toBe("2026-09-22");
    expect(data.filedReport?.who).toEqual({ name: "Hector Alvarez", email: "hector@example.test", canBeEmailed: true, isYou: false });
    expect(data.filedReport?.source).toMatch(/filed that day's daily field report/);

    expect(data.onScheduleThatDay.map((p) => p.name)).toEqual(["Tino Reyes", "Hector Alvarez"]);
    for (const p of data.onScheduleThatDay) expect(p.source).toMatch(/planned, not attended/);
    // The crew member: named, unreachable, and said to be so — not dropped.
    expect(data.onScheduleThatDay[0]).toMatchObject({ email: null, canBeEmailed: false, hasPhoneOnFile: true });

    // The foreman who would actually know: a crew member, hours that day,
    // no email column to reach him by. Named, marked, not substituted.
    expect(data.loggedHoursThatDay).toEqual([
      { name: "Hector Ramirez", email: null, canBeEmailed: false, hasPhoneOnFile: true, isYou: false, source: "logged hours on the job that day — paperwork somebody filed, not a register" },
    ]);

    expect(data.assignedToJob.map((p) => p.name)).toEqual(["Hector Alvarez", "Cyrus Obiz"]);
    for (const p of data.assignedToJob) expect(p.source).toMatch(/roster with no date/);
    // The asker is marked, so nobody offers to email them.
    expect(data.assignedToJob[1].isYou).toBe(true);

    // The GC's people, from ContactPerson, with titles — and one with no
    // email is listed as unreachable rather than dropped.
    expect(data.gcPeopleWithheld).toBe(false);
    expect(data.atTheGc.map((p) => [p.name, p.title, p.canBeEmailed])).toEqual([
      ["Dana Whitfield", "PM", false],
      ["Marco Silva", "Superintendent", true],
    ]);
    for (const p of data.atTheGc) expect(p.source).toMatch(/Brackett Construction, the GC on this job/);

    expect(result.summary).toEqual({ peopleNamed: 8, peopleWhoCanBeEmailed: 4, namedWithNoEmail: 3 });
    expect(result.citations.map((c) => c.href)).toEqual(["/field-reports", "/schedule"]);
  });

  it("withholds the GC's people from an asker who could not open the contact page's People section, and says so", async () => {
    const payroll: Principal = { role: "MEMBER", jobFunction: "PAYROLL_COMPLIANCE" }; // MANAGE_FIELD, no MANAGE_ESTIMATING
    const result = await runTool({ companyId: "co-1", principal: payroll, userId: "u-x" }, "who_would_know", { jobName: "Riverside", day: "last Tuesday" });
    const data = result.data as Data;
    expect(data.gcPeopleWithheld).toBe(true);
    expect(data.atTheGc).toEqual([]);
    expect(calls.people).toEqual([]);
    // The rest still comes back.
    expect(data.loggedHoursThatDay).toHaveLength(1);
  });

  it("never returns a name from another company's rows — every query carried companyId", async () => {
    const result = await runTool(actor, "who_would_know", { jobName: "Riverside", day: "last Tuesday" });
    const text = JSON.stringify(result.data);
    expect(text).not.toContain("Other Co Foreman");
    expect(text).not.toContain("leak@other.test");
    expect(text).not.toContain("Leaky Person");
    for (const where of [...calls.job, ...calls.report, ...calls.schedule, ...calls.people]) {
      expect(where.companyId, JSON.stringify(where)).toBe("co-1");
    }
    // TimeEntry has no companyId column; its scope is the job just read
    // in-company, so the query must be BY THAT JOB and nothing wider.
    for (const where of calls.hours) expect(where.jobId, JSON.stringify(where)).toBe("j1");
    expect(calls.report.length).toBeGreaterThan(0);
    expect(calls.schedule.length).toBeGreaterThan(0);
    expect(calls.hours.length).toBeGreaterThan(0);
    expect(calls.people.length).toBeGreaterThan(0);
  });

  it("with no day, falls back to the most recent report's filer and reads no schedule", async () => {
    const result = await runTool(actor, "who_would_know", { jobName: "Riverside" });
    const data = result.data as Data;
    expect(data.day).toBeNull();
    expect(data.filedReport?.day).toBe("2026-09-24");
    expect(data.filedReport?.who?.isYou).toBe(true);
    expect(data.onScheduleThatDay).toEqual([]);
    expect(data.loggedHoursThatDay).toEqual([]);
    expect(calls.schedule).toEqual([]);
    expect(calls.hours).toEqual([]);
  });

  it("says plainly when nothing names anyone for that day, rather than returning an empty shape", async () => {
    const result = await runTool(actor, "who_would_know", { jobName: "Northgate", day: "last Tuesday" });
    expect(result.unavailable).toMatch(/names anyone for Sep 22, 2026/);
    expect(result.unavailable).toMatch(/Other GC has no people on file/);
    expect(result.unavailable).toMatch(/no one on the data to ask/);
  });

  it("refuses a day it cannot read instead of guessing one, and asks for it as a date", async () => {
    const result = await runTool(actor, "who_would_know", { jobName: "Riverside", day: "the other week" });
    expect(result.data).toBeNull();
    expect(result.unavailable).toMatch(/can't read "the other week" as a day/);
    expect(calls.report).toEqual([]);
  });

  it("asks which job when none was named, and refuses a job that is not on the account", async () => {
    expect((await runTool(actor, "who_would_know", { day: "yesterday" })).unavailable).toMatch(/Which job/);
    expect((await runTool(actor, "who_would_know", { jobName: "Towers", day: "yesterday" })).unavailable).toMatch(/No job matches "Towers"/);
  });

  it("is refused outright to a person without MANAGE_FIELD, before any row is read", async () => {
    const estimator: Principal = { role: "MEMBER", jobFunction: "ESTIMATOR" };
    const result = await runTool({ companyId: "co-1", principal: estimator }, "who_would_know", { jobName: "Riverside", day: "yesterday" });
    expect(result.data).toBeNull();
    expect(result.unavailable).toMatch(/MANAGE_FIELD/);
    expect(calls.job).toEqual([]);
  });
});
