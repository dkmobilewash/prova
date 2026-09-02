import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The closeout package lifecycle, executed against a real Postgres.
 *
 * `.dbtest.ts`, so the normal suite does not collect it — CI has no
 * database. Run it against a SCRATCH one:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 *
 * The guards worth having here are guards about ROWS — an attempt number
 * that must not be reissued, two packages that must not be outstanding at
 * once — and none of them can be checked from a return value.
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

const {
  deleteCloseoutSubmission,
  recordCloseoutResponse,
  reopenCloseoutSubmission,
  submitCloseoutPackage,
} = await import("./closeoutSubmissions");

let jobId = "";
let otherJobId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

async function attempts() {
  return prisma.closeoutSubmission.findMany({ where: { jobId }, orderBy: { attempt: "asc" } });
}

async function latest() {
  const rows = await attempts();
  const row = rows[rows.length - 1];
  if (!row) throw new Error("no submission found");
  return row;
}

describe("closeout submissions against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Closeout Test Co" } });
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `co_test_${Date.now()}`,
        email: `co_owner_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "Test GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Closeout Test Job" },
    });
    context.company.id = company.id;
    context.id = user.id;
    jobId = job.id;

    const other = await prisma.company.create({ data: { name: "Not Ours Ltd" } });
    const otherContact = await prisma.contact.create({ data: { companyId: other.id, name: "Their GC" } });
    const otherJob = await prisma.job.create({
      data: { companyId: other.id, contactId: otherContact.id, name: "Theirs" },
    });
    otherJobId = otherJob.id;
  });

  afterAll(async () => {
    const otherJob = await prisma.job.findUnique({ where: { id: otherJobId } });
    await prisma.closeoutSubmission.deleteMany({ where: { companyId: context.company.id } });
    await prisma.closeoutSubmissionCounter.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { companyId: context.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    if (otherJob) {
      await prisma.closeoutSubmission.deleteMany({ where: { jobId: otherJobId } });
      await prisma.closeoutSubmissionCounter.deleteMany({ where: { jobId: otherJobId } });
      await prisma.job.delete({ where: { id: otherJobId } });
      await prisma.contact.deleteMany({ where: { companyId: otherJob.companyId } });
      await prisma.company.delete({ where: { id: otherJob.companyId } });
    }
    await prisma.$disconnect();
  });

  it("records the package going out on the date entered", async () => {
    expect(
      await submitCloseoutPackage(
        form({ jobId, submittedOn: "2026-08-11", method: "emailed to PM" }),
      ),
    ).toEqual({ ok: true });

    const row = await latest();
    expect(row.attempt).toBe(1);
    expect(row.status).toBe("SUBMITTED");
    // Backdated. A stamped date would make the days-with-the-GC figure —
    // the only reason to keep this at all — a fiction.
    expect(row.submittedOn.toISOString()).toBe("2026-08-11T00:00:00.000Z");
    expect(row.submittedByUserId).toBe(context.id);
    expect(revalidated).toContain("/closeout");
  });

  it("submits without demanding a complete checklist", async () => {
    // Deliberate: packages go out short a document all the time, with the
    // missing one promised to follow. Refusing to record that would make
    // the log stop matching what happened.
    const items = await prisma.closeoutItem.count({ where: { jobId } });
    expect(items).toBe(0);
    expect((await latest()).attempt).toBe(1);
  });

  it("refuses a second package while the GC still has the first", async () => {
    const result = await submitCloseoutPackage(form({ jobId, submittedOn: "2026-08-20" }));
    expect(result.ok).toBe(false);
    expect((await attempts()).length).toBe(1);
  });

  it("refuses a response dated before the package went out", async () => {
    const row = await latest();
    expect(
      await recordCloseoutResponse(
        row.id,
        form({ outcome: "ACCEPTED", respondedOn: "2026-08-01" }),
      ),
    ).toEqual({ ok: false, error: "They can't have answered before the package went out." });
  });

  it("refuses a rejection with no reason recorded", async () => {
    const row = await latest();
    const result = await recordCloseoutResponse(
      row.id,
      form({ outcome: "REJECTED", respondedOn: "2026-08-18" }),
    );
    expect(result.ok).toBe(false);
    expect((await latest()).status).toBe("SUBMITTED");
  });

  it("records the rejection and what they said", async () => {
    const row = await latest();
    expect(
      await recordCloseoutResponse(
        row.id,
        form({
          outcome: "REJECTED",
          respondedOn: "2026-08-18",
          gcResponse: "Waiver was the conditional form",
        }),
      ),
    ).toEqual({ ok: true });

    const rejected = await latest();
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.respondedOn?.toISOString()).toBe("2026-08-18T00:00:00.000Z");
    expect(rejected.gcResponse).toBe("Waiver was the conditional form");
  });

  it("refuses a second attempt dated before the first came back", async () => {
    const result = await submitCloseoutPackage(form({ jobId, submittedOn: "2026-08-15" }));
    expect(result.ok).toBe(false);
    expect((await attempts()).length).toBe(1);
  });

  it("lets the next attempt go once the first came back", async () => {
    expect(await submitCloseoutPackage(form({ jobId, submittedOn: "2026-08-25" }))).toEqual({
      ok: true,
    });
    expect((await latest()).attempt).toBe(2);
  });

  it("will not reopen an older attempt while a newer one exists", async () => {
    const [first] = await attempts();
    const result = await reopenCloseoutSubmission(first.id);
    expect(result.ok).toBe(false);
    // Two outstanding packages at once would make "days with the GC"
    // measure whichever one happened to sort first.
    expect((await attempts()).filter((a) => a.status === "SUBMITTED").length).toBe(1);
  });

  it("will not delete an older attempt while a newer one exists", async () => {
    const [first] = await attempts();
    expect((await deleteCloseoutSubmission(first.id)).ok).toBe(false);
    expect((await attempts()).length).toBe(2);
  });

  it("never reissues an attempt number after a delete", async () => {
    const second = await latest();
    expect(await deleteCloseoutSubmission(second.id)).toEqual({ ok: true });
    expect((await attempts()).length).toBe(1);

    expect(await submitCloseoutPackage(form({ jobId, submittedOn: "2026-08-26" }))).toEqual({
      ok: true,
    });
    // 3, not 2 — a GC quoting "the second submission" is never pointed at
    // two different packages.
    expect((await latest()).attempt).toBe(3);
  });

  it("accepts the package and reopens it back to SUBMITTED", async () => {
    const row = await latest();
    expect(
      await recordCloseoutResponse(row.id, form({ outcome: "ACCEPTED", respondedOn: "2026-08-30" })),
    ).toEqual({ ok: true });
    expect((await latest()).status).toBe("ACCEPTED");

    expect(await reopenCloseoutSubmission(row.id)).toEqual({ ok: true });
    const reopened = await latest();
    expect(reopened.status).toBe("SUBMITTED");
    expect(reopened.respondedOn).toBeNull();
    expect(reopened.gcResponse).toBeNull();
    // The submitted date and attempt number are what the GC also holds.
    expect(reopened.submittedOn.toISOString()).toBe("2026-08-26T00:00:00.000Z");
    expect(reopened.attempt).toBe(3);
  });

  it("refuses another company's job and another company's submission", async () => {
    expect(await submitCloseoutPackage(form({ jobId: otherJobId, submittedOn: "2026-08-11" }))).toEqual({
      ok: false,
      error: "Job not found",
    });

    const foreign = await prisma.closeoutSubmission.create({
      data: {
        companyId: (await prisma.job.findUniqueOrThrow({ where: { id: otherJobId } })).companyId,
        jobId: otherJobId,
        attempt: 1,
        submittedOn: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    const notFound = { ok: false, error: "Closeout submission not found" };
    expect(await recordCloseoutResponse(foreign.id, form({ outcome: "ACCEPTED" }))).toEqual(notFound);
    expect(await reopenCloseoutSubmission(foreign.id)).toEqual(notFound);
    expect(await deleteCloseoutSubmission(foreign.id)).toEqual(notFound);
    expect(await prisma.closeoutSubmission.findUnique({ where: { id: foreign.id } })).not.toBeNull();
  });

  it("lets a non-owner submit and record, but not delete", async () => {
    context.role = "MEMBER";
    try {
      const row = await latest();
      expect(
        await recordCloseoutResponse(row.id, form({ outcome: "ACCEPTED", respondedOn: "2026-08-31" })),
      ).toEqual({ ok: true });
      expect(await deleteCloseoutSubmission(row.id)).toEqual({
        ok: false,
        error: "Only the account owner can delete a closeout submission",
      });
      expect(await prisma.closeoutSubmission.findUnique({ where: { id: row.id } })).not.toBeNull();
    } finally {
      context.role = "OWNER";
    }
  });
});
