import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * CrewMember and TimeEntry.crewMemberId, against a real Postgres.
 *
 * Two jobs, and the second one matters more than the first.
 *
 * 1. The guarantees this model rests on are DATABASE guarantees — CHECK
 *    constraints and BEFORE UPDATE triggers written by hand in
 *    20260905183000_add_crew_members. None of them exist in the Prisma
 *    schema, so `pnpm typecheck` cannot see them and the unit suite cannot
 *    reach them. If they are not exercised here they are not exercised
 *    anywhere, and a lock nobody ever tried to break is a lock nobody
 *    knows is fitted. That is the "written, documented, and never called"
 *    shape CLAUDE.md warns about, and it is the reason this file exists at
 *    all for a model the application does not yet call.
 *
 * 2. NOTHING ABOUT AN EXISTING TIME ENTRY CHANGED. The last describe block
 *    creates a time entry exactly the way logTimeEntry does today — a User
 *    and no crew member — and reads it back through the real certified
 *    payroll query and roll-up. Same rows, same hours, same dollars. That
 *    is the claim the whole change stands on and it is checked rather than
 *    asserted in a comment.
 *
 * Run it against a SCRATCH database, never a real one — see
 * vitest.db.config.ts for the recipe. It creates and deletes companies.
 */

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadCertifiedPayrollWeekEntries } = await import("./certified-payroll-query");
const { buildCertifiedPayrollSummary } = await import("./certified-payroll");

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const WEEK = utc("2026-08-23"); // Sunday

const stamp = Date.now();

let companyId = "";
let otherCompanyId = "";
let jobId = "";
let craftId = "";
let localId = "";
let officeUserId = "";
let spareUserId = "";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: `Crew Test Co ${stamp}` } });
  const other = await prisma.company.create({ data: { name: `Crew Test Co B ${stamp}` } });
  const office = await prisma.user.create({
    data: {
      companyId: company.id,
      clerkId: `crew_office_${stamp}`,
      email: `crew_office_${stamp}@example.test`,
      name: "Office Alice",
      role: "OWNER",
    },
  });
  const spare = await prisma.user.create({
    data: {
      companyId: company.id,
      clerkId: `crew_spare_${stamp}`,
      email: `crew_spare_${stamp}@example.test`,
      name: "Spare Bob",
      role: "MEMBER",
    },
  });
  const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
  const job = await prisma.job.create({
    data: { companyId: company.id, contactId: contact.id, name: "Courthouse" },
  });
  const local = await prisma.unionLocal.create({
    data: {
      parentInternational: "Carpenters",
      localNumber: `crew-${stamp}`,
      jurisdictionName: "Testland",
    },
  });
  await prisma.companyUnionAgreement.create({
    data: { companyId: company.id, unionLocalId: local.id, effectiveFrom: utc("2026-01-01") },
  });
  const craft = await prisma.craftClassification.create({
    data: { unionLocalId: local.id, name: "Journeyman", tier: "JOURNEYMAN" },
  });
  await prisma.fringeRateSchedule.create({
    data: {
      craftClassificationId: craft.id,
      effectiveFrom: utc("2026-01-01"),
      baseWage: "52.00",
      pensionRate: "9.50",
      vacationRate: "3.25",
      healthWelfareRate: "11.75",
      trainingRate: "0.85",
    },
  });

  companyId = company.id;
  otherCompanyId = other.id;
  jobId = job.id;
  craftId = craft.id;
  localId = local.id;
  officeUserId = office.id;
  spareUserId = spare.id;
});

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { jobId } });
  await prisma.crewMember.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.fringeRateSchedule.deleteMany({ where: { craftClassificationId: craftId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.companyUnionAgreement.deleteMany({ where: { companyId } });
  await prisma.craftClassification.deleteMany({ where: { id: craftId } });
  await prisma.unionLocal.deleteMany({ where: { id: localId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await prisma.$disconnect();
});

async function makeCrew(overrides: Record<string, unknown> = {}) {
  return prisma.crewMember.create({
    data: {
      companyId,
      legalFirstName: "Jesus",
      legalLastName: "Alvarez",
      ...overrides,
    },
  });
}

describe("CrewMember identity is locked after creation", () => {
  it("refuses to rename a crew member", async () => {
    const crew = await makeCrew({ legalLastName: `Alvarez ${stamp}a` });
    await expect(
      prisma.crewMember.update({ where: { id: crew.id }, data: { legalLastName: "Alvarado" } }),
    ).rejects.toThrow(/locked after creation/);

    // and the row is untouched, which is the part a filed WH-347 depends on
    const after = await prisma.crewMember.findUniqueOrThrow({ where: { id: crew.id } });
    expect(after.legalLastName).toBe(`Alvarez ${stamp}a`);
  });

  it("refuses to change the individual identifying number", async () => {
    const crew = await makeCrew({ legalLastName: `Ident ${stamp}`, identifyingNumberLast4: "4821" });
    await expect(
      prisma.crewMember.update({ where: { id: crew.id }, data: { identifyingNumberLast4: "9999" } }),
    ).rejects.toThrow(/locked after creation/);
  });

  it("refuses to move a crew member to another company", async () => {
    const crew = await makeCrew({ legalLastName: `Tenant ${stamp}` });
    await expect(
      prisma.crewMember.update({ where: { id: crew.id }, data: { companyId: otherCompanyId } }),
    ).rejects.toThrow(/locked after creation/);
  });

  it("still allows the fields that are NOT identity — address, phone, note, archive", async () => {
    const crew = await makeCrew({ legalLastName: `Mutable ${stamp}` });
    const updated = await prisma.crewMember.update({
      where: { id: crew.id },
      data: {
        addressLine1: "1400 W Charleston Blvd",
        city: "Las Vegas",
        state: "NV",
        zip: "89102",
        phone: "702-555-0134",
        note: "moved apartments",
        archivedAt: utc("2026-09-01"),
      },
    });
    expect(updated.city).toBe("Las Vegas");
    expect(updated.archivedAt).toEqual(utc("2026-09-01"));
    // archiving is not deleting: the row is still there to be named
    expect(await prisma.crewMember.findUnique({ where: { id: crew.id } })).not.toBeNull();
  });
});

describe("the individual identifying number is four digits or nothing", () => {
  it("accepts exactly four digits", async () => {
    const crew = await makeCrew({ legalLastName: `Four ${stamp}`, identifyingNumberLast4: "0007" });
    expect(crew.identifyingNumberLast4).toBe("0007");
  });

  it("accepts null — a crew member exists before payroll sends the number", async () => {
    const crew = await makeCrew({ legalLastName: `Null ${stamp}` });
    expect(crew.identifyingNumberLast4).toBeNull();
  });

  it("REFUSES a full SSN — the reason there is no column for one", async () => {
    await expect(
      makeCrew({ legalLastName: `Ssn ${stamp}`, identifyingNumberLast4: "123-45-6789" }),
    ).rejects.toThrow();
  });

  it("refuses a partial or over-long number", async () => {
    await expect(makeCrew({ legalLastName: `Short ${stamp}`, identifyingNumberLast4: "482" })).rejects.toThrow();
    await expect(makeCrew({ legalLastName: `Long ${stamp}`, identifyingNumberLast4: "48210" })).rejects.toThrow();
  });
});

describe("a crew member cannot exist without a name", () => {
  it("refuses a blank surname", async () => {
    await expect(makeCrew({ legalFirstName: "Jesus", legalLastName: "   " })).rejects.toThrow();
  });

  it("refuses a blank given name", async () => {
    await expect(makeCrew({ legalFirstName: "", legalLastName: `Blank ${stamp}` })).rejects.toThrow();
  });
});

describe("a crew member who later gets a real login", () => {
  it("links forward, once, and never moves", async () => {
    const crew = await makeCrew({ legalLastName: `Linked ${stamp}` });
    expect(crew.linkedUserId).toBeNull();

    // The transition: they complete a Clerk sign-up and the crew record is
    // pointed at the new login.
    const linked = await prisma.crewMember.update({
      where: { id: crew.id },
      data: { linkedUserId: officeUserId, linkedAt: utc("2026-09-05") },
    });
    expect(linked.linkedUserId).toBe(officeUserId);

    // and it can never be pointed at anybody else afterwards
    await expect(
      prisma.crewMember.update({ where: { id: crew.id }, data: { linkedUserId: spareUserId } }),
    ).rejects.toThrow(/cannot be changed once set/);

    // not even back to nothing
    await expect(
      prisma.crewMember.update({ where: { id: crew.id }, data: { linkedUserId: null, linkedAt: null } }),
    ).rejects.toThrow(/cannot be changed once set/);
  });

  it("refuses a second crew record claiming the same login", async () => {
    const first = await makeCrew({ legalLastName: `Claim1 ${stamp}` });
    await prisma.crewMember.update({
      where: { id: first.id },
      data: { linkedUserId: spareUserId, linkedAt: utc("2026-09-05") },
    });
    await expect(
      makeCrew({ legalLastName: `Claim2 ${stamp}`, linkedUserId: spareUserId, linkedAt: utc("2026-09-05") }),
    ).rejects.toThrow();
  });

  it("refuses a link with no date on it", async () => {
    await expect(makeCrew({ legalLastName: `NoDate ${stamp}`, linkedUserId: officeUserId })).rejects.toThrow();
  });
});

describe("the payroll number is unique per company, and optional", () => {
  it("refuses the same number twice in one company", async () => {
    await makeCrew({ legalLastName: `Num1 ${stamp}`, employeeNumber: `E-${stamp}` });
    await expect(makeCrew({ legalLastName: `Num2 ${stamp}`, employeeNumber: `E-${stamp}` })).rejects.toThrow();
  });

  it("allows the same number in a different company", async () => {
    const elsewhere = await prisma.crewMember.create({
      data: {
        companyId: otherCompanyId,
        legalFirstName: "Someone",
        legalLastName: `Else ${stamp}`,
        employeeNumber: `E-${stamp}`,
      },
    });
    expect(elsewhere.employeeNumber).toBe(`E-${stamp}`);
  });

  it("allows any number of crew members with no payroll number", async () => {
    await makeCrew({ legalLastName: `NoNum1 ${stamp}` });
    await makeCrew({ legalLastName: `NoNum2 ${stamp}` });
    const none = await prisma.crewMember.count({ where: { companyId, employeeNumber: null } });
    expect(none).toBeGreaterThanOrEqual(2);
  });
});

describe("an hour, once attributed to a crew member, does not change hands", () => {
  it("refuses to repoint a time entry at a different crew member", async () => {
    const jose = await makeCrew({ legalFirstName: "Jose", legalLastName: `Reyes ${stamp}` });
    const marco = await makeCrew({ legalFirstName: "Marco", legalLastName: `Diaz ${stamp}` });

    const entry = await prisma.timeEntry.create({
      data: {
        jobId,
        employeeUserId: officeUserId,
        crewMemberId: jose.id,
        craftClassificationId: craftId,
        date: utc("2026-08-26"),
        hours: "8",
      },
    });

    await expect(
      prisma.timeEntry.update({ where: { id: entry.id }, data: { crewMemberId: marco.id } }),
    ).rejects.toThrow(/cannot be reassigned once set/);

    await prisma.timeEntry.delete({ where: { id: entry.id } });
  });

  it("refuses to delete a crew member who has hours on the record", async () => {
    const crew = await makeCrew({ legalFirstName: "Ana", legalLastName: `Ortiz ${stamp}` });
    const entry = await prisma.timeEntry.create({
      data: {
        jobId,
        employeeUserId: officeUserId,
        crewMemberId: crew.id,
        craftClassificationId: craftId,
        date: utc("2026-08-27"),
        hours: "8",
      },
    });

    await expect(prisma.crewMember.delete({ where: { id: crew.id } })).rejects.toThrow();

    await prisma.timeEntry.delete({ where: { id: entry.id } });
  });

  it("lets an entry be attributed for the first time — NULL to a crew member is the allowed direction", async () => {
    const crew = await makeCrew({ legalFirstName: "Luis", legalLastName: `Mora ${stamp}` });
    const entry = await prisma.timeEntry.create({
      data: { jobId, employeeUserId: officeUserId, date: utc("2026-08-28"), hours: "8" },
    });
    expect(entry.crewMemberId).toBeNull();

    const attributed = await prisma.timeEntry.update({
      where: { id: entry.id },
      data: { crewMemberId: crew.id },
    });
    expect(attributed.crewMemberId).toBe(crew.id);

    await prisma.timeEntry.delete({ where: { id: entry.id } });
  });
});

describe("every existing time-entry path is unchanged", () => {
  /**
   * The regression. These rows are created exactly the way logTimeEntry
   * creates them today — a User, no crew member, nothing about this change
   * mentioned — and read back through the real query and the real roll-up.
   *
   * The figures are the ones certified-payroll-query.dbtest.ts already
   * pins for the same fixture: 40 hours, $3,094.00. If adding a column and
   * two triggers moved a number on a filing, it moves here.
   */
  const rows: [string, string, "STRAIGHT" | "OVERTIME"][] = [
    ["2026-08-24", "8", "STRAIGHT"],
    ["2026-08-25", "8", "STRAIGHT"],
    ["2026-08-26", "8", "STRAIGHT"],
    ["2026-08-27", "8", "STRAIGHT"],
    ["2026-08-28", "8", "STRAIGHT"],
  ];

  beforeAll(async () => {
    for (const [date, hours, payType] of rows) {
      await prisma.timeEntry.create({
        data: {
          jobId,
          employeeUserId: officeUserId,
          craftClassificationId: craftId,
          date: utc(date),
          hours,
          payType,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({ where: { jobId } });
  });

  it("creates a time entry with no crew member at all — logTimeEntry's shape still works", async () => {
    const entries = await prisma.timeEntry.findMany({ where: { jobId } });
    expect(entries).toHaveLength(rows.length);
    for (const e of entries) {
      expect(e.crewMemberId).toBeNull();
      expect(e.employeeUserId).toBe(officeUserId);
    }
  });

  it("loads the week through the real certified-payroll query, unchanged", async () => {
    const entries = await loadCertifiedPayrollWeekEntries(companyId, jobId, WEEK);
    expect(entries).toHaveLength(5);
    // The include still yields a non-null User. This is the dereference
    // every read path does without a null check.
    for (const e of entries) {
      expect(e.employeeUser.name ?? e.employeeUser.email).toBe("Office Alice");
    }
  });

  it("prints the same 40 hours and $3,094.00 it printed before this migration", async () => {
    const entries = await loadCertifiedPayrollWeekEntries(companyId, jobId, WEEK);
    const schedules = await prisma.fringeRateSchedule.findMany({
      where: { craftClassificationId: craftId },
    });
    const byCraft = new Map([
      [
        craftId,
        schedules.map((s) => ({
          baseWage: Number(s.baseWage),
          pensionRate: s.pensionRate != null ? Number(s.pensionRate) : null,
          vacationRate: s.vacationRate != null ? Number(s.vacationRate) : null,
          healthWelfareRate: s.healthWelfareRate != null ? Number(s.healthWelfareRate) : null,
          trainingRate: s.trainingRate != null ? Number(s.trainingRate) : null,
          effectiveFrom: s.effectiveFrom,
          effectiveTo: s.effectiveTo,
        })),
      ],
    ]);

    const summaries = buildCertifiedPayrollSummary(
      entries.map((e) => ({
        employeeUserId: e.employeeUserId,
        employeeName: e.employeeUser.name ?? e.employeeUser.email,
        craftClassificationId: e.craftClassificationId,
        craftLabel: "Carpenters — Journeyman",
        date: e.date,
        hours: Number(e.hours),
        payType: e.payType,
        perDiemAmount: e.perDiemAmount != null ? Number(e.perDiemAmount) : null,
        travelPayAmount: e.travelPayAmount != null ? Number(e.travelPayAmount) : null,
      })),
      byCraft,
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0].employeeName).toBe("Office Alice");
    expect(summaries[0].totalHours).toBe(40);
    expect(summaries[0].totalWageCost).toBeCloseTo(3094.0, 2);
    expect(summaries[0].hasUncomputedHours).toBe(false);
  });

  it("does not let a crew member's hours leak into another company's week", async () => {
    const entries = await loadCertifiedPayrollWeekEntries(otherCompanyId, jobId, WEEK);
    expect(entries).toEqual([]);
  });
});
