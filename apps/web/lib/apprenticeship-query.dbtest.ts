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
let unionLocalId = "";

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
  if (unionLocalId) {
    await prisma.craftClassification.deleteMany({ where: { unionLocalId } });
    await prisma.unionLocal.delete({ where: { id: unionLocalId } });
  }
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
});

/**
 * The two halves of #104 item 9, against real rows.
 *
 * Both are hours on an indenture record — the figure a sponsor or a state
 * compliance officer reads off a programme — and neither can be executed
 * without a database, because both live in the `where` of a Prisma
 * aggregate rather than in the pure module. The existing tests above passed
 * before this fix and after it, which is precisely why they are not the
 * evidence for it.
 *
 * ONE fixture, worked by hand, used by all three tests:
 *
 *   2026-02-10   8h   Drywall apprentice
 *   2026-03-10   7h   Drywall apprentice
 *   2026-04-20   9h   Plaster apprentice
 *   2026-05-11   5h   no craft recorded
 *   2026-08-12   6h   Drywall apprentice
 *                --
 *                35h  worked in total
 *
 * The old code answered 35 for every indenture this person held.
 */
describe("the OJT window closes with the indenture, and counts one craft", () => {
  let danaId = "";
  let drywallId = "";
  let plasterId = "";
  let drywallEnrollmentId = "";
  let plasterEnrollmentId = "";

  const standingFor = async (id: string) => {
    const rows = await loadApprenticeships(companyId, TODAY);
    return rows.find((r) => r.enrollmentId === id)!;
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const local = await prisma.unionLocal.create({
      data: {
        parentInternational: "United Brotherhood of Carpenters",
        localNumber: `ojt-${stamp}`,
        jurisdictionName: "Test",
      },
    });
    unionLocalId = local.id;

    const drywall = await prisma.craftClassification.create({
      data: { unionLocalId: local.id, name: "Drywall Apprentice", tier: "APPRENTICE" },
    });
    drywallId = drywall.id;
    const plaster = await prisma.craftClassification.create({
      data: { unionLocalId: local.id, name: "Plaster Apprentice", tier: "APPRENTICE" },
    });
    plasterId = plaster.id;

    const dana = await prisma.user.create({
      data: {
        companyId,
        clerkId: `dana_${stamp}`,
        email: `dana_${stamp}@example.test`,
        name: "Dana Two-Trades",
        role: "MEMBER",
      },
    });
    danaId = dana.id;

    const drywallEnrollment = await prisma.apprenticeshipEnrollment.create({
      data: {
        companyId,
        apprenticeUserId: danaId,
        craftClassificationId: drywallId,
        sponsorName: "Carpenters JATC",
        enrolledOn: new Date("2026-01-05T00:00:00.000Z"),
        requiredOjtHoursPerPeriod: "1000",
      },
    });
    drywallEnrollmentId = drywallEnrollment.id;

    await prisma.timeEntry.createMany({
      data: [
        { jobId, employeeUserId: danaId, date: new Date("2026-02-10T00:00:00.000Z"), hours: "8", craftClassificationId: drywallId },
        { jobId, employeeUserId: danaId, date: new Date("2026-03-10T00:00:00.000Z"), hours: "7", craftClassificationId: drywallId },
        { jobId, employeeUserId: danaId, date: new Date("2026-04-20T00:00:00.000Z"), hours: "9", craftClassificationId: plasterId },
        { jobId, employeeUserId: danaId, date: new Date("2026-05-11T00:00:00.000Z"), hours: "5" },
        { jobId, employeeUserId: danaId, date: new Date("2026-08-12T00:00:00.000Z"), hours: "6", craftClassificationId: drywallId },
      ],
    });
  });

  it("counts only the indenture's OWN craft, and names the hours it left out", async () => {
    // 8 + 7 + 6 = 21 drywall hours. NOT 35: the 9 plaster hours belong to
    // a different trade and the 5 untagged ones cannot be attributed to
    // any indenture at all.
    const row = await standingFor(drywallEnrollmentId);

    expect(row.ojtHoursThisPeriod).toBe(21);
    // Reported rather than silently dropped. "They are 979 short" and "5 of
    // their hours carry no craft tag" are different sentences to a sponsor.
    expect(row.untaggedHoursThisPeriod).toBe(5);
    expect(row.ojtCountedThrough).toBe(TODAY);
    expect(row.ojtShortfall).toBe(979);
  });

  it("stops accruing on the day the indenture COMPLETED", async () => {
    // Completed 30 June. The 12 August shift is real work, and it is not
    // work done under this indenture — 8 + 7 = 15, and the 6 falls out.
    // The old window ran to today unconditionally, so a programme finished
    // in June kept growing for as long as the person kept working.
    await prisma.apprenticeshipEnrollment.update({
      where: { id: drywallEnrollmentId },
      data: { completedOn: new Date("2026-06-30T00:00:00.000Z") },
    });

    const row = await standingFor(drywallEnrollmentId);

    expect(row.ojtHoursThisPeriod).toBe(15);
    expect(row.ojtCountedThrough).toBe("2026-06-30");
    // The 11 May untagged shift is inside the closed window and still says so.
    expect(row.untaggedHoursThisPeriod).toBe(5);
    expect(row.ojtShortfall).toBe(985);
  });

  it("does not count one shift against two indentures", async () => {
    // A carpenter indenturing into plaster. Before the craft filter, BOTH
    // programmes read 35 hours off the same five shifts — two sponsors each
    // told the same day's work satisfied theirs, which is a false claim on
    // both records rather than a display quirk on one.
    const plasterEnrollment = await prisma.apprenticeshipEnrollment.create({
      data: {
        companyId,
        apprenticeUserId: danaId,
        craftClassificationId: plasterId,
        sponsorName: "OPCMIA JATC",
        enrolledOn: new Date("2026-01-05T00:00:00.000Z"),
        requiredOjtHoursPerPeriod: "1000",
      },
    });
    plasterEnrollmentId = plasterEnrollment.id;

    const drywall = await standingFor(drywallEnrollmentId);
    const plaster = await standingFor(plasterEnrollmentId);

    expect(drywall.ojtHoursThisPeriod).toBe(15);
    expect(plaster.ojtHoursThisPeriod).toBe(9);
    // 15 + 9 = 24, and the 5 untagged hours are on neither. What is NOT
    // true any more is that both read 35.
    expect(drywall.ojtHoursThisPeriod + plaster.ojtHoursThisPeriod).toBe(24);
  });

  afterAll(async () => {
    await prisma.apprenticeshipEnrollment.deleteMany({
      where: { id: { in: [drywallEnrollmentId, plasterEnrollmentId].filter(Boolean) } },
    });
    await prisma.timeEntry.deleteMany({ where: { employeeUserId: danaId } });
  });
});
