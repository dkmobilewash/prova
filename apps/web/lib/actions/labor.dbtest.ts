import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Correcting logged time, against real rows (issue #63).
 *
 * These are certified payroll hours: the record produced when somebody asks
 * what a person was paid and for what. Until now the ONLY way to fix a
 * wrong figure was to delete the row and type a new one, so nothing showed
 * that a correction had been made, when, or by whom — a foreman's honest
 * 10-becomes-8 was indistinguishable from a number being quietly rewritten.
 *
 * Everything here needs a database. The identity lock is enforced by the
 * update's `data` OMITTING those columns, and the before-image is written
 * in the same transaction as the change — neither is a claim any pure
 * function can be asked to make.
 */

const context = { company: { id: "" }, id: "", name: "Rosa Foreman", email: "", role: "OWNER" as string };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { updateTimeEntry, deleteTimeEntry } = await import("./labor");

let jobId = "";
let employeeId = "";
let otherJobId = "";
let unionLocalId = "";
let craftId = "";
let lineItemId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

/** The row every test starts from: 10 straight hours with a per diem. */
const logTen = () =>
  prisma.timeEntry.create({
    data: {
      jobId,
      employeeUserId: employeeId,
      date: new Date("2026-08-31T00:00:00.000Z"),
      hours: "10",
      payType: "STRAIGHT",
      craftClassificationId: craftId,
      lineItemId,
      perDiemAmount: "45",
      note: "Long day",
    },
  });

beforeAll(async () => {
  const stamp = Date.now();
  const company = await prisma.company.create({ data: { name: "Time Correction Co" } });
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      clerkId: `tc_${stamp}`,
      email: `tc_${stamp}@example.test`,
      name: "Rosa Foreman",
      role: "OWNER",
    },
  });
  const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
  const job = await prisma.job.create({
    data: { companyId: company.id, contactId: contact.id, name: "Civic Center" },
  });
  const otherJob = await prisma.job.create({
    data: { companyId: company.id, contactId: contact.id, name: "Somewhere else" },
  });
  const lineItem = await prisma.jobLineItem.create({
    data: { jobId: job.id, description: "03-100 Framing" },
  });

  const local = await prisma.unionLocal.create({
    data: {
      parentInternational: "United Brotherhood of Carpenters",
      localNumber: `tc-${stamp}`,
      jurisdictionName: "Test",
    },
  });
  // The craft has to be reachable from THIS company for
  // craftClassificationIdFromForm to accept it.
  await prisma.companyUnionAgreement.create({
    data: {
      companyId: company.id,
      unionLocalId: local.id,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  const craft = await prisma.craftClassification.create({
    data: { unionLocalId: local.id, name: "Journeyman Carpenter", tier: "JOURNEYMAN" },
  });

  context.company.id = company.id;
  context.id = user.id;
  context.email = user.email;
  jobId = job.id;
  otherJobId = otherJob.id;
  employeeId = user.id;
  unionLocalId = local.id;
  craftId = craft.id;
  lineItemId = lineItem.id;
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { job: { companyId: context.company.id } } });
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.companyUnionAgreement.deleteMany({ where: { companyId: context.company.id } });
  await prisma.job.deleteMany({ where: { companyId: context.company.id } });
  await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
  await prisma.user.deleteMany({ where: { companyId: context.company.id } });
  await prisma.company.delete({ where: { id: context.company.id } });
  await prisma.craftClassification.deleteMany({ where: { unionLocalId } });
  await prisma.unionLocal.delete({ where: { id: unionLocalId } });
  await prisma.$disconnect();
});

describe("updateTimeEntry keeps the figure it replaces", () => {
  it("writes the new hours AND a before-image of the old ones", async () => {
    const entry = await logTen();

    const result = await updateTimeEntry(
      jobId,
      entry.id,
      form({
        hours: "8",
        payType: "OVERTIME",
        craftClassificationId: craftId,
        lineItemId,
        perDiemAmount: "45",
        note: "Corrected against the timesheet",
        reason: "Entered 10 straight; the timesheet says 8.",
      }),
    );
    expect(result).toEqual({ ok: true });

    const after = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { corrections: true },
    });

    // The figure that goes on the sheet.
    expect(Number(after.hours)).toBe(8);
    expect(after.payType).toBe("OVERTIME");

    // And the one it replaced, kept beside it rather than destroyed.
    expect(after.corrections).toHaveLength(1);
    const [correction] = after.corrections;
    expect(Number(correction.previousHours)).toBe(10);
    expect(correction.previousPayType).toBe("STRAIGHT");
    expect(Number(correction.previousPerDiemAmount)).toBe(45);
    expect(correction.previousNote).toBe("Long day");
    expect(correction.previousCraftLabel).toBe("Journeyman Carpenter");
    expect(correction.previousLineItemLabel).toBe("03-100 Framing");
    expect(correction.reason).toBe("Entered 10 straight; the timesheet says 8.");
    expect(correction.correctedByName).toBe("Rosa Foreman");

    await prisma.timeEntry.delete({ where: { id: entry.id } });
  });

  it("will not move the entry's date or its employee, even when the form says so", async () => {
    // The identity of an evidence record, locked the way CLAUDE.md already
    // locks safety incidents, RFIs and submittals. A wrong DATE is a
    // different day's work — a new entry and a deleted one, not an edit —
    // and the lock is by OMISSION from the update's `data`, so there is no
    // field here for a later change to start honouring.
    const entry = await logTen();
    const stranger = await prisma.user.create({
      data: {
        companyId: context.company.id,
        clerkId: `tcx_${Date.now()}`,
        email: `tcx_${Date.now()}@example.test`,
        name: "Someone Else",
        role: "MEMBER",
      },
    });

    const result = await updateTimeEntry(
      jobId,
      entry.id,
      form({
        hours: "9",
        payType: "STRAIGHT",
        // Both of these must be ignored.
        date: "2026-09-04",
        employeeUserId: stranger.id,
        reason: "Trying to move the day and the person.",
      }),
    );
    expect(result).toEqual({ ok: true });

    const after = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(Number(after.hours)).toBe(9);
    expect(after.date.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(after.employeeUserId).toBe(employeeId);

    await prisma.timeEntry.delete({ where: { id: entry.id } });
    await prisma.user.delete({ where: { id: stranger.id } });
  });

  it("refuses a correction with no stated reason, and changes NOTHING", async () => {
    // A correction with no reason is a silent replacement wearing a
    // timestamp, which is the thing the table exists to stop. The refusal
    // is RETURNED — production redacts a thrown one to a digest.
    const entry = await logTen();

    const result = await updateTimeEntry(jobId, entry.id, form({ hours: "8", reason: "   " }));
    expect(result.ok).toBe(false);

    const after = await prisma.timeEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { corrections: true },
    });
    expect(Number(after.hours)).toBe(10);
    expect(after.corrections).toEqual([]);

    await prisma.timeEntry.delete({ where: { id: entry.id } });
  });

  it("refuses hours that are not a positive number", async () => {
    const entry = await logTen();
    for (const hours of ["", "0", "-4", "eight"]) {
      const result = await updateTimeEntry(jobId, entry.id, form({ hours, reason: "Fixing it." }));
      expect(result.ok, `hours=${JSON.stringify(hours)}`).toBe(false);
    }
    const after = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(Number(after.hours)).toBe(10);

    await prisma.timeEntry.delete({ where: { id: entry.id } });
  });

  it("refuses an entry that is not on this job, rather than throwing", async () => {
    const entry = await logTen();
    const result = await updateTimeEntry(otherJobId, entry.id, form({ hours: "8", reason: "No." }));
    expect(result.ok).toBe(false);

    const after = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(Number(after.hours)).toBe(10);

    await prisma.timeEntry.delete({ where: { id: entry.id } });
  });

  it("keeps saying what was there when a classification is later renamed", async () => {
    // The snapshot columns carry no foreign key on purpose. A craft renamed
    // next year must not rewrite what this row says was recorded at the
    // time — that is the difference between a record and a view.
    const entry = await logTen();
    await updateTimeEntry(
      jobId,
      entry.id,
      form({ hours: "8", craftClassificationId: craftId, reason: "Timesheet says 8." }),
    );

    await prisma.craftClassification.update({
      where: { id: craftId },
      data: { name: "Carpenter (Journey Level)" },
    });

    const [correction] = await prisma.timeEntryCorrection.findMany({
      where: { timeEntryId: entry.id },
    });
    expect(correction.previousCraftLabel).toBe("Journeyman Carpenter");

    await prisma.craftClassification.update({
      where: { id: craftId },
      data: { name: "Journeyman Carpenter" },
    });
    await prisma.timeEntry.delete({ where: { id: entry.id } });
  });
});

describe("deleteTimeEntry", () => {
  it("takes the entry's corrections with it, and returns rather than throws", async () => {
    const entry = await logTen();
    await updateTimeEntry(jobId, entry.id, form({ hours: "8", reason: "Timesheet says 8." }));
    expect(await prisma.timeEntryCorrection.count({ where: { timeEntryId: entry.id } })).toBe(1);

    expect(await deleteTimeEntry(jobId, entry.id)).toEqual({ ok: true });

    expect(await prisma.timeEntry.findUnique({ where: { id: entry.id } })).toBeNull();
    // A correction to a row that no longer exists is an orphan, not
    // evidence — ON DELETE CASCADE, asserted rather than assumed.
    expect(await prisma.timeEntryCorrection.count({ where: { timeEntryId: entry.id } })).toBe(0);
  });

  it("refuses an entry on a different job without taking the page down", async () => {
    const entry = await logTen();
    const result = await deleteTimeEntry(otherJobId, entry.id);
    expect(result.ok).toBe(false);
    expect(await prisma.timeEntry.findUnique({ where: { id: entry.id } })).not.toBeNull();

    await prisma.timeEntry.delete({ where: { id: entry.id } });
  });
});
