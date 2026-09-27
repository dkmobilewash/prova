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

const JOBS = [
  { id: "j1", companyId: "co-1", name: "Riverside Medical Office Building", assignments: [{ user: HECTOR }, { user: ME }] },
  { id: "j2", companyId: "co-1", name: "Northgate Apartments", assignments: [] },
  { id: "j9", companyId: "co-2", name: "Riverside Towers", assignments: [{ user: OTHER }] },
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

const calls = vi.hoisted(() => ({ job: [] as Where[], report: [] as Where[], schedule: [] as Where[] }));
const served = (rows: Record<string, unknown>[], log: Where[]) => ({
  findMany: async ({ where }: { where: Where }) => {
    log.push(where);
    return rows.filter((row) => matches(row, where));
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
  assignedToJob: Named[];
};

beforeEach(() => {
  calls.job.length = 0;
  calls.report.length = 0;
  calls.schedule.length = 0;
});

describe("who_would_know", () => {
  it("is offered on MANAGE_FIELD, the gate of the field-reports page it reads the filer from", () => {
    const tool = TOOLS.find((t) => t.name === "who_would_know")!;
    expect(tool.capability).toBe("MANAGE_FIELD");
    expect(Object.keys(tool.input_schema.properties).sort()).toEqual(["day", "jobName"]);
    // The description says, in so many words, that this is not attendance.
    expect(tool.description).toMatch(/never who was there/i);
    expect(tool.description).toMatch(/does NOT record attendance/);
  });

  it("names the filer, the scheduled and the assigned for the day, each with its source, and says attendance is not recorded", async () => {
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

    expect(data.assignedToJob.map((p) => p.name)).toEqual(["Hector Alvarez", "Cyrus Obiz"]);
    for (const p of data.assignedToJob) expect(p.source).toMatch(/roster with no date/);
    // The asker is marked, so nobody offers to email them.
    expect(data.assignedToJob[1].isYou).toBe(true);

    expect(result.summary).toEqual({ peopleNamed: 5, peopleWhoCanBeEmailed: 3, crewMembersWithNoEmail: 1 });
    expect(result.citations.map((c) => c.href)).toEqual(["/field-reports", "/schedule"]);
  });

  it("never returns a name from another company's rows — every query carried companyId", async () => {
    const result = await runTool(actor, "who_would_know", { jobName: "Riverside", day: "last Tuesday" });
    const text = JSON.stringify(result.data);
    expect(text).not.toContain("Other Co Foreman");
    expect(text).not.toContain("leak@other.test");
    for (const where of [...calls.job, ...calls.report, ...calls.schedule]) {
      expect(where.companyId, JSON.stringify(where)).toBe("co-1");
    }
    expect(calls.report.length).toBeGreaterThan(0);
    expect(calls.schedule.length).toBeGreaterThan(0);
  });

  it("with no day, falls back to the most recent report's filer and reads no schedule", async () => {
    const result = await runTool(actor, "who_would_know", { jobName: "Riverside" });
    const data = result.data as Data;
    expect(data.day).toBeNull();
    expect(data.filedReport?.day).toBe("2026-09-24");
    expect(data.filedReport?.who?.isYou).toBe(true);
    expect(data.onScheduleThatDay).toEqual([]);
    expect(calls.schedule).toEqual([]);
  });

  it("says plainly when nothing names anyone for that day, rather than returning an empty shape", async () => {
    const result = await runTool(actor, "who_would_know", { jobName: "Northgate", day: "last Tuesday" });
    expect(result.unavailable).toMatch(/names anyone for Sep 22, 2026/);
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
