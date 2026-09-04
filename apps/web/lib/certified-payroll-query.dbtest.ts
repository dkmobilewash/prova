import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * The certified-payroll week, executed against a real Postgres.
 *
 * The unit suite (certified-payroll-week.test.ts) already pins the window
 * itself and the dollar figure it produces. This one answers the question
 * the unit test cannot: that a Prisma `date: { gte, lte }` against a real
 * `TimeEntry.date` column agrees with the inclusive Saturday bound the
 * pure test assumes. The whole fix rests on rows being stored at UTC
 * midnight, and an inclusive bound is exact only if that holds in the
 * database rather than in a comment.
 *
 * Fixture is the issue's repro: a full Mon-Fri week plus a SUNDAY makeup
 * shift belonging to the NEXT week. The bug certified that Sunday on both.
 */

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadCertifiedPayrollWeekEntries } = await import("./certified-payroll-query");
const { buildCertifiedPayrollSummary } = await import("./certified-payroll");
const { certifiedPayrollWeekWindow } = await import("./certified-payroll-week");

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const WEEK = utc("2026-08-23"); // Sunday
const NEXT_WEEK = utc("2026-08-30"); // the following Sunday

let companyId = "";
let jobId = "";
let craftId = "";
let localId = "";
let alice = "";

describe("loadCertifiedPayrollWeekEntries against real rows", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "CP Query Test Co" } });
    const a = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `cpq_a_${Date.now()}`,
        email: `cpq_a_${Date.now()}@example.test`,
        name: "Alice",
        role: "OWNER",
      },
    });
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Courthouse" },
    });
    const local = await prisma.unionLocal.create({
      data: {
        parentInternational: "Carpenters",
        localNumber: `405-${Date.now()}`,
        jurisdictionName: "Testland",
      },
    });
    await prisma.companyUnionAgreement.create({
      data: { companyId: company.id, unionLocalId: local.id, effectiveFrom: utc("2026-01-01") },
    });
    const craft = await prisma.craftClassification.create({
      data: { unionLocalId: local.id, name: "Journeyman" },
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
    jobId = job.id;
    craftId = craft.id;
    localId = local.id;
    alice = a.id;

    const rows: [string, string, "STRAIGHT" | "OVERTIME"][] = [
      ["2026-08-24", "8", "STRAIGHT"],
      ["2026-08-25", "8", "STRAIGHT"],
      ["2026-08-26", "8", "STRAIGHT"],
      ["2026-08-27", "8", "STRAIGHT"],
      ["2026-08-28", "8", "STRAIGHT"],
      // A Sunday makeup shift. It belongs to the week of 8/30 and to
      // nothing else.
      ["2026-08-30", "6", "OVERTIME"],
    ];
    for (const [date, hours, payType] of rows) {
      await prisma.timeEntry.create({
        data: {
          jobId,
          employeeUserId: alice,
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
    await prisma.fringeRateSchedule.deleteMany({ where: { craftClassificationId: craftId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.companyUnionAgreement.deleteMany({ where: { companyId } });
    await prisma.craftClassification.deleteMany({ where: { id: craftId } });
    await prisma.unionLocal.deleteMany({ where: { id: localId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("stores every TimeEntry.date at UTC midnight — the invariant the inclusive bound rests on", async () => {
    const entries = await prisma.timeEntry.findMany({ where: { jobId }, select: { date: true } });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.date.toISOString().slice(10)).toBe("T00:00:00.000Z");
    }
  });

  it("does not pull the next week's Sunday into this week", async () => {
    const entries = await loadCertifiedPayrollWeekEntries(companyId, jobId, WEEK);
    expect(entries).toHaveLength(5); // the bug returned 6
    expect(entries.map((e) => e.date.toISOString().slice(0, 10))).not.toContain("2026-08-30");
  });

  it("still includes the Saturday bound itself", async () => {
    // The other way this could be broken: an exclusive bound that drops a
    // real Saturday off the filing.
    const saturday = await prisma.timeEntry.create({
      data: { jobId, employeeUserId: alice, craftClassificationId: craftId, date: utc("2026-08-29"), hours: "4" },
    });
    const entries = await loadCertifiedPayrollWeekEntries(companyId, jobId, WEEK);
    expect(entries.map((e) => e.id)).toContain(saturday.id);
    await prisma.timeEntry.delete({ where: { id: saturday.id } });
  });

  it("certifies each day on exactly one week", async () => {
    const a = await loadCertifiedPayrollWeekEntries(companyId, jobId, WEEK);
    const b = await loadCertifiedPayrollWeekEntries(companyId, jobId, NEXT_WEEK);
    const ids = [...a, ...b].map((e) => e.id);
    // The bug: the 8/30 row's id appears in both.
    expect(new Set(ids).size).toBe(ids.length);
    expect(b.map((e) => e.date.toISOString().slice(0, 10))).toEqual(["2026-08-30"]);
  });

  it("reports 40 hours and $3,094.00 for the week of 2026-08-23", async () => {
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
        craftLabel: "Carpenters 405 — Journeyman",
        date: e.date,
        hours: Number(e.hours),
        payType: e.payType,
        perDiemAmount: null,
        travelPayAmount: null,
      })),
      byCraft,
    );

    // The figures on a document filed under penalty. The bug printed 46
    // hours and $3,714.10, with 6 hours of overtime on a week in which
    // none was worked.
    expect(summaries[0].totalHours).toBe(40);
    expect(summaries[0].totalWageCost).toBeCloseTo(3094.0, 2);
    expect(summaries[0].rows[0].hoursByPayType.OVERTIME).toBe(0);
  });

  it("refuses another company's job", async () => {
    const other = await prisma.company.create({ data: { name: "Not ours" } });
    const entries = await loadCertifiedPayrollWeekEntries(other.id, jobId, WEEK);
    expect(entries).toEqual([]);
    await prisma.company.delete({ where: { id: other.id } });
  });

  it("queries the window the page prints", async () => {
    const { gte, lte } = certifiedPayrollWeekWindow(WEEK);
    expect(gte.toISOString()).toBe("2026-08-23T00:00:00.000Z");
    expect(lte.toISOString()).toBe("2026-08-29T00:00:00.000Z");
  });
});
