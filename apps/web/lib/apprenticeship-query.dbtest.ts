import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * loadApprenticeships against a real Postgres.
 *
 * The unit tests cover the deciding. This covers the part nothing else
 * executes: that on-the-job hours are SUMMED FROM TimeEntry over the
 * current period's window, and that the window moves when a period is
 * signed off. That is the claim the whole design rests on -- hours are
 * derived, never stored -- and it cannot be checked without real rows.
 */

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadApprenticeships } = await import("./apprenticeship-query");

let companyId = "";
let jobId = "";
let apprenticeId = "";
let enrollmentId = "";

const TODAY = "2026-09-03";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Apprenticeship Test Co" } });
  companyId = company.id;

  const stamp = Date.now();
  const apprentice = await prisma.user.create({
    data: {
      companyId,
      clerkId: `app_${stamp}`,
      email: `app_${stamp}@example.test`,
      name: "Sam Apprentice",
      role: "MEMBER",
    },
  });
  apprenticeId = apprentice.id;

  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({
    data: { companyId, contactId: contact.id, name: "Hospital" },
  });
  jobId = job.id;

  const enrollment = await prisma.apprenticeshipEnrollment.create({
    data: {
      companyId,
      apprenticeUserId: apprenticeId,
      sponsorName: "Carpenters JATC",
      enrolledOn: new Date("2026-01-05T00:00:00.000Z"),
      requiredOjtHoursPerPeriod: "1000",
      requiredClassroomHoursPerPeriod: "144",
    },
  });
  enrollmentId = enrollment.id;

  // Two shifts BEFORE any sign-off, and one after the sign-off date below.
  await prisma.timeEntry.createMany({
    data: [
      { jobId, employeeUserId: apprenticeId, date: new Date("2026-02-02T00:00:00.000Z"), hours: "8" },
      { jobId, employeeUserId: apprenticeId, date: new Date("2026-03-02T00:00:00.000Z"), hours: "8" },
      { jobId, employeeUserId: apprenticeId, date: new Date("2026-08-03T00:00:00.000Z"), hours: "6" },
    ],
  });
});

afterAll(async () => {
  await prisma.apprenticeshipPeriodRecord.deleteMany({ where: { enrollmentId } });
  await prisma.apprenticeshipEnrollment.deleteMany({ where: { companyId } });
  await prisma.timeEntry.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe("loadApprenticeships against a real database", () => {
  it("sums OJT hours from TimeEntry rather than reading a stored total", async () => {
    // 8 + 8 + 6, all of it inside period 1 because nothing is signed off.
    const [row] = await loadApprenticeships(companyId, TODAY);

    expect(row.ojtHoursThisPeriod).toBe(22);
    expect(row.period).toBe(1);
    expect(row.periodStartedOn).toBe("2026-01-05");
    expect(row.ojt).toBe("SHORT");
    expect(row.ojtShortfall).toBe(978);
  });

  it("moves the window when a period is signed off, WITHOUT touching a timesheet", async () => {
    // The claim the design rests on. Signing off period 1 on 1 July must
    // drop the February and March shifts out of the count and leave only
    // the August one -- with no write to TimeEntry anywhere.
    await prisma.apprenticeshipPeriodRecord.create({
      data: {
        enrollmentId,
        periodNumber: 1,
        classroomHours: "150",
        signedOffOn: new Date("2026-07-01T00:00:00.000Z"),
      },
    });

    const [row] = await loadApprenticeships(companyId, TODAY);

    expect(row.period).toBe(2);
    expect(row.periodStartedOn).toBe("2026-07-01");
    expect(row.ojtHoursThisPeriod).toBe(6);
  });

  it("reports the signed-off period's classroom hours as met", async () => {
    const [row] = await loadApprenticeships(companyId, TODAY);
    const first = row.periods.find((p) => p.periodNumber === 1);

    expect(first?.classroomHours).toBe(150);
    expect(first?.classroom).toBe("MET");
    expect(first?.classroomShortfall).toBe(0);
  });

  it("refuses to measure OJT when the programme states no requirement", async () => {
    await prisma.apprenticeshipEnrollment.update({
      where: { id: enrollmentId },
      data: { requiredOjtHoursPerPeriod: null },
    });

    const [row] = await loadApprenticeships(companyId, TODAY);

    expect(row.ojt).toBe("NO_REQUIREMENT_RECORDED");
    expect(row.ojtShortfall).toBeNull();
    // and the hours themselves are still reported — not knowing the target
    // is no reason to hide the work done
    expect(row.ojtHoursThisPeriod).toBe(6);

    await prisma.apprenticeshipEnrollment.update({
      where: { id: enrollmentId },
      data: { requiredOjtHoursPerPeriod: "1000" },
    });
  });

  it("does not count another company's hours for the same person", async () => {
    const other = await prisma.company.create({ data: { name: "Someone Else" } });
    const otherContact = await prisma.contact.create({
      data: { companyId: other.id, name: "Their GC" },
    });
    const otherJob = await prisma.job.create({
      data: { companyId: other.id, contactId: otherContact.id, name: "Their job" },
    });
    await prisma.timeEntry.create({
      data: {
        jobId: otherJob.id,
        employeeUserId: apprenticeId,
        date: new Date("2026-08-10T00:00:00.000Z"),
        hours: "12",
      },
    });

    const [row] = await loadApprenticeships(companyId, TODAY);
    expect(row.ojtHoursThisPeriod).toBe(6);

    await prisma.timeEntry.deleteMany({ where: { jobId: otherJob.id } });
    await prisma.job.delete({ where: { id: otherJob.id } });
    await prisma.contact.delete({ where: { id: otherContact.id } });
    await prisma.company.delete({ where: { id: other.id } });
  });

  it("is scoped to the company", async () => {
    const other = await prisma.company.create({ data: { name: "Nobody" } });
    expect(await loadApprenticeships(other.id, TODAY)).toEqual([]);
    await prisma.company.delete({ where: { id: other.id } });
  });

  describe("issue #104 finding 9: the OJT window used to run past the indenture's own end", () => {
    // Two defects in one window: [periodStarted, today] had no upper cap at
    // completedOn/cancelledOn, so a COMPLETED indenture kept accruing "this
    // period" hours for as long as `today` kept moving; and it had no
    // craftClassificationId filter, so a SECOND enrollment for the same
    // apprentice (a different craft, or a re-indenture) pulled in hours
    // that belonged to the first one. Both are real double-counts on the
    // same underlying pool of TimeEntry rows for one person.
    let localId = "";
    let craftAId = "";
    let craftBId = "";
    let enrollmentAId = "";
    let enrollmentBId = "";

    beforeAll(async () => {
      const local = await prisma.unionLocal.create({
        data: { companyId, parentInternational: "Test Intl", localNumber: `L-${Date.now()}`, jurisdictionName: "Testville" },
      });
      localId = local.id;
      const craftA = await prisma.craftClassification.create({
        data: { companyId, unionLocalId: localId, name: "Craft A" },
      });
      const craftB = await prisma.craftClassification.create({
        data: { companyId, unionLocalId: localId, name: "Craft B" },
      });
      craftAId = craftA.id;
      craftBId = craftB.id;

      // Enrollment A: craft A, COMPLETED on 2026-06-01.
      const enrollmentA = await prisma.apprenticeshipEnrollment.create({
        data: {
          companyId,
          apprenticeUserId: apprenticeId,
          craftClassificationId: craftAId,
          sponsorName: "Carpenters JATC",
          enrolledOn: new Date("2026-01-01T00:00:00.000Z"),
          completedOn: new Date("2026-06-01T00:00:00.000Z"),
          requiredOjtHoursPerPeriod: "1000",
        },
      });
      enrollmentAId = enrollmentA.id;

      // Enrollment B: craft B, still active, started while A was still
      // open -- the realistic shape (cross-training, or a re-indenture)
      // that would double-count without a craft filter.
      const enrollmentB = await prisma.apprenticeshipEnrollment.create({
        data: {
          companyId,
          apprenticeUserId: apprenticeId,
          craftClassificationId: craftBId,
          sponsorName: "Carpenters JATC",
          enrolledOn: new Date("2026-05-01T00:00:00.000Z"),
          requiredOjtHoursPerPeriod: "1000",
        },
      });
      enrollmentBId = enrollmentB.id;

      await prisma.timeEntry.createMany({
        data: [
          // Craft A hours, before A completed -- these count for A.
          { jobId, employeeUserId: apprenticeId, craftClassificationId: craftAId, date: new Date("2026-02-01T00:00:00.000Z"), hours: "20" },
          // Craft A hours AFTER A completed -- must NOT count for A.
          { jobId, employeeUserId: apprenticeId, craftClassificationId: craftAId, date: new Date("2026-08-01T00:00:00.000Z"), hours: "40" },
          // Craft B hours, inside A's [enrolledOn, today] window but a
          // DIFFERENT craft -- must count for B, never for A.
          { jobId, employeeUserId: apprenticeId, craftClassificationId: craftBId, date: new Date("2026-05-15T00:00:00.000Z"), hours: "15" },
        ],
      });
    });

    afterAll(async () => {
      await prisma.timeEntry.deleteMany({ where: { craftClassificationId: { in: [craftAId, craftBId] } } });
      await prisma.apprenticeshipEnrollment.deleteMany({ where: { id: { in: [enrollmentAId, enrollmentBId] } } });
      await prisma.craftClassification.deleteMany({ where: { id: { in: [craftAId, craftBId] } } });
      await prisma.unionLocal.delete({ where: { id: localId } });
    });

    it("caps a completed enrollment's OJT hours at completedOn, not at today", async () => {
      const rows = await loadApprenticeships(companyId, TODAY);
      const a = rows.find((r) => r.enrollmentId === enrollmentAId)!;
      // Only the 20 hours logged before 2026-06-01. The 40 hours logged in
      // August must not appear here even though TODAY is well after them.
      expect(a.ojtHoursThisPeriod).toBe(20);
    });

    it("does not let a second enrollment's different-craft hours inflate this one's total", async () => {
      const rows = await loadApprenticeships(companyId, TODAY);
      const a = rows.find((r) => r.enrollmentId === enrollmentAId)!;
      const b = rows.find((r) => r.enrollmentId === enrollmentBId)!;
      // A's 20 hours must not have picked up B's 15 craft-B hours, even
      // though both fall inside a window that, before the craft filter,
      // A's query would have matched with no craft condition at all.
      expect(a.ojtHoursThisPeriod).toBe(20);
      expect(b.ojtHoursThisPeriod).toBe(15);
    });
  });
});
