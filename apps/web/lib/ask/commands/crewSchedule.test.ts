import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * schedule_crew against a where-honouring fake and a faked action.
 *
 *   - RESOLVE NEVER WRITES: the action is a spy and every write method on
 *     the fake throws. Only execute, which only the tap reaches, calls it.
 *   - Tenant scope: the other company has a "Mike" and a "Riverside", and
 *     the fake honours `companyId` on users, crew, jobs and schedule days,
 *     so a lookup that lost it offers a chip row or schedules the wrong man.
 *   - A worker is a User OR a crew member, as the /schedule form offers
 *     them, with archived crew left out.
 *   - The duplicate the action refuses is linked before the card, not
 *     after the tap.
 */

type Where = Record<string, unknown>;
function matches(row: Record<string, unknown>, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, want]) => {
    if (key === "OR") return (want as Where[]).some((branch) => matches(row, branch));
    const have = row[key];
    if (want instanceof Date) return have instanceof Date && have.getTime() === want.getTime();
    if (want !== null && typeof want === "object") {
      const op = want as { contains?: string; equals?: string };
      if (op.contains !== undefined) return String(have ?? "").toLowerCase().includes(op.contains.toLowerCase());
      if (op.equals !== undefined) return String(have ?? "").toLowerCase() === op.equals.toLowerCase();
      return false;
    }
    return have === want;
  });
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const USERS = [
  { id: "u-mike", companyId: "co-1", name: "Mike Rossi", email: "mike@co1.example" },
  { id: "u-other", companyId: "co-2", name: "Mike Other", email: "mike@co2.example" },
];
const CREW = [
  { id: "cm-1", companyId: "co-1", archivedAt: null, legalFirstName: "Luis", legalLastName: "Ortega" },
  { id: "cm-2", companyId: "co-1", archivedAt: day("2026-01-01"), legalFirstName: "Luis", legalLastName: "Archived" },
];
const JOBS = [
  { id: "j1", companyId: "co-1", name: "Riverside", status: "IN_PROGRESS", contact: { name: "Turner" }, createdAt: day("2026-01-01") },
  { id: "j2", companyId: "co-2", name: "Riverside", status: "IN_PROGRESS", contact: { name: "Other GC" }, createdAt: day("2026-01-01") },
];
let DAYS: Record<string, unknown>[] = [];

const fake = vi.hoisted(() => ({
  scheduleCrewDay: vi.fn(),
  write: vi.fn(() => {
    throw new Error("resolve wrote to the database");
  }),
}));

const served = (rows: () => Record<string, unknown>[]) => ({
  findMany: async ({ where }: { where: Where }) => rows().filter((row) => matches(row, where)),
  findFirst: async ({ where }: { where: Where }) => rows().find((row) => matches(row, where)) ?? null,
  create: fake.write,
  createMany: fake.write,
  update: fake.write,
  deleteMany: fake.write,
});

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    user: served(() => USERS),
    crewMember: served(() => CREW),
    job: served(() => JOBS),
    crewScheduleDay: served(() => DAYS),
  },
}));
vi.mock("@/lib/actions/crewSchedule", () => ({ scheduleCrewDay: fake.scheduleCrewDay }));

const { scheduleCrewCommand } = await import("./crewSchedule");

// 2026-09-18 is a Friday.
const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER" as const, jobFunction: null }, today: "2026-09-18" };
const line = (result: { preview?: { label: string; value: string }[] }, label: string) =>
  result.preview?.find((l) => l.label === label)?.value;

beforeEach(() => {
  DAYS = [];
  fake.scheduleCrewDay.mockReset();
  fake.write.mockClear();
});

describe("schedule_crew", () => {
  it("asks for whatever the person left out, and writes nothing", async () => {
    expect(await scheduleCrewCommand.resolve(ctx, { workerName: "Mike" })).toEqual({ kind: "need", missing: "which job, which day" });
    expect(fake.scheduleCrewDay).not.toHaveBeenCalled();
  });

  it("puts THIS company's Mike on THIS company's Riverside tomorrow — a card, not a write", async () => {
    const result = await scheduleCrewCommand.resolve(ctx, { workerName: "Mike", jobName: "Riverside", workDate: "tomorrow" });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.existing).toBeUndefined();
    expect(result.resolved).toEqual({
      worker: "user:u-mike",
      workerName: "Mike Rossi",
      jobId: "j1",
      jobName: "Riverside",
      workDate: "2026-09-19",
      note: null,
    });
    expect(line(result, "Day")).toMatch(/Sep 19, 2026 \(Saturday\)/);
    expect(fake.scheduleCrewDay).not.toHaveBeenCalled();
    expect(fake.write).not.toHaveBeenCalled();
  });

  it("finds a crew member with no login by the legal name, and never an archived one", async () => {
    const result = await scheduleCrewCommand.resolve(ctx, { workerName: "Luis Ortega", jobName: "Riverside", workDate: "Tuesday" });
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.resolved.worker).toBe("crew:cm-1");
      expect(result.resolved.workDate).toBe("2026-09-22");
    }
  });

  it("refuses a name nobody on the team or crew has, pointing at the team page", async () => {
    expect(await scheduleCrewCommand.resolve(ctx, { workerName: "Dmitri", jobName: "Riverside", workDate: "tomorrow" })).toMatchObject({
      kind: "refuse",
      href: "/team",
    });
  });

  it("re-asserts a chip's worker in-company — another company's Mike is refused", async () => {
    const forged = await scheduleCrewCommand.resolve(ctx, { worker: "user:u-other", jobName: "Riverside", workDate: "tomorrow" });
    expect(forged.kind).toBe("refuse");
  });

  it("links the day that already exists instead of offering a button that can only fail", async () => {
    DAYS = [{ id: "d1", companyId: "co-1", jobId: "j1", workDate: day("2026-09-19"), scheduledUserId: "u-mike", crewMemberId: null }];
    const result = await scheduleCrewCommand.resolve(ctx, { workerName: "Mike", jobName: "Riverside", workDate: "tomorrow" });
    expect(result.kind === "ready" && result.existing?.href).toBe("/schedule");
  });

  it("asks rather than counts for a relative shift with nothing to count from", async () => {
    const result = await scheduleCrewCommand.resolve(ctx, { workerName: "Mike", jobName: "Riverside", workDate: "a week later" });
    expect(["need", "ready"]).toContain(result.kind);
    if (result.kind === "ready") throw new Error("a shift must not become a day");
  });

  it("executes through scheduleCrewDay with the form's own fields, only on the tap, and shows its refusal", async () => {
    fake.scheduleCrewDay.mockResolvedValue({ ok: true });
    const ok = await scheduleCrewCommand.execute(ctx, {
      worker: "user:u-mike",
      workerName: "Mike Rossi",
      jobId: "j1",
      jobName: "Riverside",
      workDate: "2026-09-19",
      note: null,
    });
    expect(ok.ok).toBe(true);
    const form = fake.scheduleCrewDay.mock.calls[0][0] as FormData;
    expect(Object.fromEntries(form.entries())).toEqual({ jobId: "j1", worker: "user:u-mike", workDate: "2026-09-19" });

    fake.scheduleCrewDay.mockResolvedValue({ ok: false, error: "They are already on that job that day." });
    const refused = await scheduleCrewCommand.execute(ctx, {
      worker: "user:u-mike",
      workerName: "Mike Rossi",
      jobId: "j1",
      jobName: "Riverside",
      workDate: "2026-09-19",
      note: null,
    });
    expect(refused).toEqual({ ok: false, error: "They are already on that job that day." });
  });
});
