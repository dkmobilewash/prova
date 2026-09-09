import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * logTimeEntry's duplicate-submission guard, against a real Postgres.
 *
 * Named `.dbtest.ts` so the normal suite does not collect it — CI has no
 * database. Run it against a SCRATCH one, exactly as backcharges.dbtest.ts
 * documents:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 *
 * The guard reads TimeEntry rows back with a `createdAt` window, which a
 * faked Prisma client can be made to agree with itself about; only a real
 * database proves the query actually narrows to "this exact entry, just
 * now" rather than matching everything or nothing (#102: a doubled 8-hour
 * entry read as 16 hours, doubling the WH-347, the apprentice ratio for
 * that day, and burdened cost).
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
}));

const revalidated: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

const { logTimeEntry } = await import("./labor");

let jobId = "";
let employeeUserId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

function entryForm(overrides: Record<string, string> = {}) {
  return form({
    employeeUserId,
    date: "2026-09-01",
    hours: "8",
    payType: "STRAIGHT",
    ...overrides,
  });
}

describe("logTimeEntry against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Labor Test Co" } });
    context.company.id = company.id;

    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `labor_owner_${Date.now()}`,
        email: `labor_owner_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    context.id = owner.id;

    const employee = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `labor_employee_${Date.now()}`,
        email: `labor_employee_${Date.now()}@example.test`,
        name: "Field Hand",
        role: "MEMBER",
      },
    });
    employeeUserId = employee.id;

    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Test GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Labor Test Job" },
    });
    jobId = job.id;
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { companyId: context.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  it("logs a normal entry", async () => {
    expect(await logTimeEntry(jobId, entryForm())).toEqual({ ok: true });
    expect(await prisma.timeEntry.count({ where: { jobId } })).toBe(1);
    expect(revalidated).toContain(`/jobs/${jobId}`);
  });

  it("refuses an identical entry submitted again moments later — the #102 double-8-hours case", async () => {
    // Same employee, date, hours and pay type as the entry just logged — a
    // double-click or a retried request, not a second real day worked.
    const result = await logTimeEntry(jobId, entryForm());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/moments ago/i);
    }

    // Still one row, and hours still sum to 8 — not the 16 the bug produced.
    const entries = await prisma.timeEntry.findMany({ where: { jobId, employeeUserId, date: new Date("2026-09-01T00:00:00.000Z") } });
    expect(entries).toHaveLength(1);
    expect(entries.reduce((sum, e) => sum + Number(e.hours), 0)).toBe(8);
  });

  it("allows a second, genuinely different entry for the same employee on the same day", async () => {
    // Different hours: a real second shift (e.g. overtime called in later),
    // not a resubmission of the first.
    expect(await logTimeEntry(jobId, entryForm({ hours: "4", payType: "OVERTIME" }))).toEqual({ ok: true });

    const entries = await prisma.timeEntry.findMany({
      where: { jobId, employeeUserId, date: new Date("2026-09-01T00:00:00.000Z") },
    });
    expect(entries).toHaveLength(2);
    expect(entries.reduce((sum, e) => sum + Number(e.hours), 0)).toBe(12);
  });

  it("allows the same entry again once the guard's window has passed", async () => {
    // Simulate time passing WITHOUT an UPDATE to TimeEntry — this codebase
    // deliberately has no update path to that table at all (see
    // lib/timeEntryWriteCensus.test.ts), so "age" the existing row by
    // deleting and recreating it with an explicit past createdAt, rather
    // than sleeping ten seconds in a test.
    const [existing] = await prisma.timeEntry.findMany({
      where: { jobId, employeeUserId, date: new Date("2026-09-01T00:00:00.000Z"), hours: "8" },
    });
    await prisma.timeEntry.delete({ where: { id: existing.id } });
    await prisma.timeEntry.create({
      data: {
        jobId,
        employeeUserId,
        date: new Date("2026-09-01T00:00:00.000Z"),
        hours: "8",
        payType: "STRAIGHT",
        createdAt: new Date(Date.now() - 60_000),
      },
    });

    expect(await logTimeEntry(jobId, entryForm())).toEqual({ ok: true });
    const entries = await prisma.timeEntry.findMany({
      where: { jobId, employeeUserId, date: new Date("2026-09-01T00:00:00.000Z"), hours: "8" },
    });
    expect(entries).toHaveLength(2);
  });
});
