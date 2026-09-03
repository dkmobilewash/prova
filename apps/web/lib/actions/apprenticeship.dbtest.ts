import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

const context = { company: { id: "" }, id: "", role: "OWNER" as string };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const {
  createApprenticeshipEnrollment,
  updateApprenticeshipEnrollment,
  deleteApprenticeshipEnrollment,
  recordApprenticeshipPeriod,
} = await import("./apprenticeship");

let apprenticeId = "";
let jobId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

const base = (over: Record<string, string> = {}) =>
  form({
    apprenticeUserId: apprenticeId,
    sponsorName: "Carpenters JATC",
    enrolledOn: "2026-01-05",
    ...over,
  });

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Apprentice Actions Co" } });
  const stamp = Date.now();
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      clerkId: `aa_${stamp}`,
      email: `aa_${stamp}@example.test`,
      role: "OWNER",
    },
  });
  const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
  const job = await prisma.job.create({
    data: { companyId: company.id, contactId: contact.id, name: "Tower" },
  });
  context.company.id = company.id;
  context.id = user.id;
  apprenticeId = user.id;
  jobId = job.id;
});

afterAll(async () => {
  await prisma.apprenticeshipPeriodRecord.deleteMany({
    where: { enrollment: { companyId: context.company.id } },
  });
  await prisma.apprenticeshipEnrollment.deleteMany({ where: { companyId: context.company.id } });
  await prisma.timeEntry.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { companyId: context.company.id } });
  await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
  await prisma.user.deleteMany({ where: { companyId: context.company.id } });
  await prisma.company.delete({ where: { id: context.company.id } });
  await prisma.$disconnect();
});

describe("apprenticeship actions against a real database", () => {
  it("stores a blank hours requirement as null, not as zero", async () => {
    // The distinction the whole feature rests on. Zero would mean the
    // programme requires no hours; null means nobody looked it up, and the
    // review reports it as unchecked rather than instantly satisfied.
    const result = await createApprenticeshipEnrollment(base({ programNumber: "CA-2026-118" }));
    expect(result.ok).toBe(true);

    const row = await prisma.apprenticeshipEnrollment.findFirst({
      where: { companyId: context.company.id },
    });
    expect(row?.requiredOjtHoursPerPeriod).toBeNull();
    expect(row?.requiredClassroomHoursPerPeriod).toBeNull();
    expect(row?.programNumber).toBe("CA-2026-118");
  });

  it("refuses an enrolment for somebody outside the company, by RETURNING", async () => {
    const other = await prisma.company.create({ data: { name: "Elsewhere" } });
    const stamp = Date.now();
    const outsider = await prisma.user.create({
      data: {
        companyId: other.id,
        clerkId: `out_${stamp}`,
        email: `out_${stamp}@example.test`,
        role: "MEMBER",
      },
    });

    const result = await createApprenticeshipEnrollment(base({ apprenticeUserId: outsider.id }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/isn't on this company's team/i);

    await prisma.user.delete({ where: { id: outsider.id } });
    await prisma.company.delete({ where: { id: other.id } });
  });

  it("refuses an indenture that is both completed and cancelled", async () => {
    const row = await prisma.apprenticeshipEnrollment.findFirstOrThrow({
      where: { companyId: context.company.id },
    });

    const result = await updateApprenticeshipEnrollment(
      row.id,
      form({
        sponsorName: "Carpenters JATC",
        completedOn: "2029-01-05",
        cancelledOn: "2027-06-01",
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not both/i);

    const after = await prisma.apprenticeshipEnrollment.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.completedOn).toBeNull();
    expect(after.cancelledOn).toBeNull();
  });

  it("refuses a second record for the same period", async () => {
    const row = await prisma.apprenticeshipEnrollment.findFirstOrThrow({
      where: { companyId: context.company.id },
    });

    const first = await recordApprenticeshipPeriod(row.id, form({ periodNumber: "1" }));
    expect(first.ok).toBe(true);

    const second = await recordApprenticeshipPeriod(row.id, form({ periodNumber: "1" }));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already recorded/i);
  });

  it("keeps classroom hours of 0 as 0, distinct from blank", async () => {
    const row = await prisma.apprenticeshipEnrollment.findFirstOrThrow({
      where: { companyId: context.company.id },
    });

    await recordApprenticeshipPeriod(row.id, form({ periodNumber: "2", classroomHours: "0" }));

    const p2 = await prisma.apprenticeshipPeriodRecord.findFirstOrThrow({
      where: { enrollmentId: row.id, periodNumber: 2 },
    });
    expect(Number(p2.classroomHours)).toBe(0);

    const p1 = await prisma.apprenticeshipPeriodRecord.findFirstOrThrow({
      where: { enrollmentId: row.id, periodNumber: 1 },
    });
    expect(p1.classroomHours).toBeNull();
  });

  it("deleting an enrolment takes its periods and NEVER a time entry", async () => {
    await prisma.timeEntry.create({
      data: {
        jobId,
        employeeUserId: apprenticeId,
        date: new Date("2026-02-02T00:00:00.000Z"),
        hours: "8",
      },
    });

    const row = await prisma.apprenticeshipEnrollment.findFirstOrThrow({
      where: { companyId: context.company.id },
    });

    const result = await deleteApprenticeshipEnrollment(row.id);
    expect(result.ok).toBe(true);

    expect(
      await prisma.apprenticeshipPeriodRecord.count({ where: { enrollmentId: row.id } }),
    ).toBe(0);
    // The hours belong to the timesheet, not to the registration.
    expect(await prisma.timeEntry.count({ where: { jobId } })).toBe(1);
  });
});
