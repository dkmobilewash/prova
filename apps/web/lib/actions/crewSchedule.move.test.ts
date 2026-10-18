import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Moving one planned day (moveCrewDay) — the edit that used to be Remove +
 * re-add. Same rules as the add path: company-scoped on the row AND the
 * target job, the same worker already on that job that day refused in
 * words, a different job the same day saved and reported as double-booked.
 */

type Day = { id: string; companyId: string; jobId: string; workDate: Date; scheduledUserId: string | null; crewMemberId: string | null };

let days: Day[] = [];
const JOBS = [
  { id: "job_a", companyId: "co_1", name: "Alder Street" },
  { id: "job_b", companyId: "co_1", name: "Birch Court" },
  { id: "job_x", companyId: "co_OTHER", name: "Not yours" },
];
const context = { company: { id: "co_1" }, id: "user_1", role: "OWNER" as string, jobFunction: null as string | null };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Equality, Date equality and `{ not: v }` — the only filters the action uses. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, want]) => {
    const have = row[key];
    if (want && typeof want === "object" && "not" in want) return have !== (want as { not: unknown }).not;
    if (want instanceof Date) return have instanceof Date && have.getTime() === want.getTime();
    return have === want;
  });
}
const withJob = (d: Day) => ({
  ...d,
  scheduledUser: d.scheduledUserId ? { name: "Ana Reyes", email: "ana@example.com" } : null,
  crewMember: null,
  job: { name: JOBS.find((j) => j.id === d.jobId)!.name },
});

vi.mock("@prova/db", () => ({
  prisma: {
    crewScheduleDay: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = days.find((d) => matches(d, where));
        return row ? withJob(row) : null;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => days.filter((d) => matches(d, where)).map(withJob),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Day> }) => {
        const hit = days.filter((d) => matches(d, where));
        days = days.map((d) => (hit.includes(d) ? { ...d, ...data } : d));
        return { count: hit.length };
      },
    },
    job: { findFirst: async ({ where }: { where: Record<string, unknown> }) => JOBS.find((j) => matches(j, where)) ?? null },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

const { moveCrewDay } = await import("./crewSchedule");

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  context.jobFunction = null;
  days = [{ id: "day_1", companyId: "co_1", jobId: "job_a", workDate: d("2026-10-14"), scheduledUserId: "u_ana", crewMemberId: null }];
});

describe("moving a planned day", () => {
  it("changes the date and job of the one row, and says so", async () => {
    const result = await moveCrewDay("day_1", form({ jobId: "job_b", workDate: "2026-10-15" }));
    expect(result).toMatchObject({ ok: true });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ jobId: "job_b", workDate: d("2026-10-15") });
    if (result.ok) expect(result.value.message).toMatch(/^Ana Reyes on Birch Court, .* — moved\.$/);
  });

  it("reports a double-booking on another job, and still moves", async () => {
    days.push({ id: "day_2", companyId: "co_1", jobId: "job_b", workDate: d("2026-10-15"), scheduledUserId: "u_ana", crewMemberId: null });
    const result = await moveCrewDay("day_1", form({ jobId: "job_a", workDate: "2026-10-15" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.message).toContain("Double-booked: Ana Reyes is also on Birch Court");
    expect(days.find((x) => x.id === "day_1")!.workDate).toEqual(d("2026-10-15"));
  });

  it("refuses, in words, when they are already on that job that day", async () => {
    days.push({ id: "day_2", companyId: "co_1", jobId: "job_b", workDate: d("2026-10-15"), scheduledUserId: "u_ana", crewMemberId: null });
    const result = await moveCrewDay("day_1", form({ jobId: "job_b", workDate: "2026-10-15" }));
    expect(result).toEqual({ ok: false, error: "Ana Reyes is already on Birch Court that day." });
    expect(days.find((x) => x.id === "day_1")).toMatchObject({ jobId: "job_a", workDate: d("2026-10-14") });
  });

  it("re-checks company scope on the row and on the target job", async () => {
    days[0].companyId = "co_OTHER";
    expect(await moveCrewDay("day_1", form({ jobId: "job_b", workDate: "2026-10-15" }))).toEqual({
      ok: false,
      error: "That day is no longer on the schedule.",
    });
    days[0].companyId = "co_1";
    expect(await moveCrewDay("day_1", form({ jobId: "job_x", workDate: "2026-10-15" }))).toEqual({
      ok: false,
      error: "That job is not on your account.",
    });
    expect(days[0]).toMatchObject({ jobId: "job_a" });
  });

  it("refuses someone without field access", async () => {
    context.role = "MEMBER";
    context.jobFunction = "ACCOUNTING";
    const result = await moveCrewDay("day_1", form({ jobId: "job_b", workDate: "2026-10-15" }));
    context.role = "OWNER";
    expect(result).toEqual({ ok: false, error: "Only someone with field access can change the crew schedule." });
    expect(days[0]).toMatchObject({ jobId: "job_a" });
  });
});
