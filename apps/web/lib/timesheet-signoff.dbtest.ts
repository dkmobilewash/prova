import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@prova/db";

/**
 * Timesheet sign-off against a real Postgres: the foreman signs a day from
 * the phone, the day's hours lock, the office approves or reopens.
 *
 * The lock's rule lives in two triggers (20260918230000_add_timesheet_signoff),
 * and a faked client cannot say anything about a trigger. So this drives the
 * real routes and actions and then goes round them to the database directly,
 * to show the refusal holds even for a write the app never checked.
 *
 * No `prisma.timeEntry.update(` here: timeEntryWriteCensus.test.ts scans
 * dbtests too. Updates go through `updateTimeEntry`, the one sanctioned path.
 */

const context = {
  company: { id: "" },
  companyId: "",
  id: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
  requireApiContext: async () => context,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { logTimeEntry, updateTimeEntry, deleteTimeEntry } = await import("./actions/labor");
const { approveTimesheetDay, reopenTimesheetDay } = await import("./actions/timesheetSignoff");
const signoffs = await import("@/app/api/v1/jobs/[id]/signoffs/route");
const timeEntries = await import("@/app/api/v1/jobs/[id]/time-entries/route");

const SIGNATURE = "M10 10L40 60L80 20M100 100L100 100";
let jobId = "";
let entryId = "";

function post(url: string, body: unknown) {
  return new NextRequest(`http://test${url}`, { method: "POST", body: JSON.stringify(body) });
}
const params = () => ({ params: Promise.resolve({ id: jobId }) });

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

async function sign(date: string, extra: Record<string, unknown> = {}) {
  return signoffs.POST(post(`/api/v1/jobs/${jobId}/signoffs`, { date, signerName: "Foreman Fred", signaturePath: SIGNATURE, ...extra }), params());
}

describe("timesheet sign-off", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Signoff Test Co" } });
    context.company.id = company.id;
    context.companyId = company.id;
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `signoff_owner_${Date.now()}`,
        email: `signoff_owner_${Date.now()}@example.test`,
        name: "Office Olga",
        role: "OWNER",
      },
    });
    context.id = owner.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Signoff GC" } });
    const job = await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Signoff Job" } });
    jobId = job.id;
    const entry = await prisma.timeEntry.create({
      data: { jobId, employeeUserId: owner.id, date: new Date("2026-09-10T00:00:00Z"), hours: "8" },
    });
    entryId = entry.id;
  });

  afterAll(async () => {
    // Sign-offs first — while one is live, the day lock refuses the delete.
    await prisma.timesheetSignoff.deleteMany({ where: { jobId } });
    await prisma.timeEntry.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { companyId: context.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  it("refuses a day with no hours, and a signature that is not the drawn path shape", async () => {
    expect((await sign("2026-09-11")).status).toBe(409);
    const markup = await sign("2026-09-10", { signaturePath: 'M1 1"/><script>' });
    expect(markup.status).toBe(400);
    expect(await prisma.timesheetSignoff.count({ where: { jobId } })).toBe(0);
  });

  it("signs the day, counting what it covered", async () => {
    const res = await sign("2026-09-10", { clientOperationId: "op-1" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ date: "2026-09-10", state: "SUBMITTED", entryCount: 1, totalHours: "8" });
    // A retried offline POST replays rather than signing twice.
    expect((await sign("2026-09-10", { clientOperationId: "op-1" })).status).toBe(200);
    // A second signature on a signed day is final: 409, never retried.
    expect((await sign("2026-09-10")).status).toBe(409);
  });

  it("locks the day's hours through every door the app has", async () => {
    const phone = await timeEntries.POST(
      post(`/api/v1/jobs/${jobId}/time-entries`, { date: "2026-09-10", hours: "2", payType: "STRAIGHT" }),
      params(),
    );
    expect(phone.status).toBe(409);

    const web = await logTimeEntry(jobId, form({ employeeUserId: context.id, date: "2026-09-10", hours: "2", payType: "STRAIGHT" }));
    expect(web).toMatchObject({ ok: false });

    const correction = await updateTimeEntry(entryId, form({ hours: "6", payType: "STRAIGHT" }));
    expect(correction).toMatchObject({ ok: false });

    await expect(deleteTimeEntry(jobId, entryId)).rejects.toThrow(/locked/);
    expect(Number((await prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } })).hours)).toBe(8);
  });

  it("holds the lock in the database even for a write the app never checked", async () => {
    await expect(
      prisma.timeEntry.create({
        data: { jobId, employeeUserId: context.id, date: new Date("2026-09-10T00:00:00Z"), hours: "1" },
      }),
    ).rejects.toThrow(/signed and locked/);
    await expect(prisma.timeEntry.delete({ where: { id: entryId } })).rejects.toThrow(/signed and locked/);
    // A different day on the same job is untouched.
    const other = await prisma.timeEntry.create({
      data: { jobId, employeeUserId: context.id, date: new Date("2026-09-09T00:00:00Z"), hours: "1" },
    });
    await prisma.timeEntry.delete({ where: { id: other.id } });
  });

  it("will not let what was signed be changed", async () => {
    const live = await prisma.timesheetSignoff.findFirstOrThrow({ where: { jobId, reopenedAt: null } });
    await expect(
      prisma.timesheetSignoff.update({ where: { id: live.id }, data: { signerName: "Someone Else" } }),
    ).rejects.toThrow(/locked after signing/);
  });

  it("approves only for someone who owns payroll", async () => {
    const live = await prisma.timesheetSignoff.findFirstOrThrow({ where: { jobId, reopenedAt: null } });
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    expect(await approveTimesheetDay(live.id)).toMatchObject({ ok: false, error: expect.stringMatching(/isn't part of your job function/) });
    context.role = "OWNER";
    context.jobFunction = null;

    expect(await approveTimesheetDay(live.id)).toEqual({ ok: true });
    expect(await approveTimesheetDay(live.id)).toMatchObject({ ok: false });
    // Approved is still locked.
    expect(await updateTimeEntry(entryId, form({ hours: "6", payType: "STRAIGHT" }))).toMatchObject({ ok: false });
  });

  it("reopens with a reason, keeps the old signature, and unlocks the hours", async () => {
    const live = await prisma.timesheetSignoff.findFirstOrThrow({ where: { jobId, reopenedAt: null } });
    expect(await reopenTimesheetDay(live.id, form({ reason: "" }))).toMatchObject({ ok: false });
    expect(await reopenTimesheetDay(live.id, form({ reason: "Fred was on the wrong cost code" }))).toEqual({ ok: true });

    expect(await updateTimeEntry(entryId, form({ hours: "6", payType: "STRAIGHT" }))).toEqual({ ok: true });

    // The reopened row is history, not deleted, and the day can be signed again.
    expect((await sign("2026-09-10")).status).toBe(201);
    const all = await prisma.timesheetSignoff.findMany({ where: { jobId }, orderBy: { signedAt: "asc" } });
    expect(all).toHaveLength(2);
    expect(all[0].reopenReason).toBe("Fred was on the wrong cost code");
    expect(all[0].approvedAt).not.toBeNull();
    expect(Number(all[1].totalHours)).toBe(6);
  });
});
