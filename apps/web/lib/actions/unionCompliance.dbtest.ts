import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Craft tiers and the two reports they drive, against a real Postgres.
 *
 * The pure suites already pin the ratio and remittance arithmetic. What
 * they cannot check is the wiring: that the access join on a GLOBAL
 * reference table actually keeps another company out, and — the one that
 * matters most — that an unclassified craft really does make a day read
 * INCOMPLETE end to end rather than quietly passing.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { setCraftTier } = await import("./unionCompliance");
const { loadCrafts, loadRatioReviews, loadRemittance } = await import("@/lib/union-compliance-query");

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let localId = "";
let otherLocalId = "";
let journeymanCraftId = "";
let apprenticeCraftId = "";
let foreignCraftId = "";
let jobId = "";
let workerId = "";

function form(tier: string, apprenticePeriod = "") {
  const fd = new FormData();
  fd.set("tier", tier);
  fd.set("apprenticePeriod", apprenticePeriod);
  return fd;
}

describe("union compliance against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Union Test Co" } });
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `uc_${Date.now()}`,
        email: `uc_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    // UnionLocal is a GLOBAL table unique on (parentInternational,
    // localNumber), so a fixed number collides with anything a previous
    // run left behind. Stamped per run.
    const stamp = Date.now();
    const local = await prisma.unionLocal.create({
      data: {
        localNumber: `t${stamp}`,
        parentInternational: "Carpenters",
        jurisdictionName: "Northern California",
      },
    });
    await prisma.companyUnionAgreement.create({
      data: { companyId: company.id, unionLocalId: local.id, effectiveFrom: utc("2026-01-01") },
    });
    const journeyman = await prisma.craftClassification.create({
      data: { unionLocalId: local.id, name: "Journeyman Drywall" },
    });
    const apprentice = await prisma.craftClassification.create({
      data: { unionLocalId: local.id, name: "Drywall Apprentice" },
    });

    // A local this company holds no agreement with — the access check.
    const otherLocal = await prisma.unionLocal.create({
      data: {
        localNumber: `x${stamp}`,
        parentInternational: "Plasterers",
        jurisdictionName: "Elsewhere",
      },
    });
    const foreign = await prisma.craftClassification.create({
      data: { unionLocalId: otherLocal.id, name: "Not ours" },
    });

    await prisma.apprenticeRatioRule.create({
      data: { unionLocalId: local.id, apprenticeCount: 1, journeymenCount: 3 },
    });
    await prisma.fringeRateSchedule.create({
      data: {
        craftClassificationId: journeyman.id,
        baseWage: "45",
        pensionRate: "8",
        vacationRate: "3",
        healthWelfareRate: "11",
        trainingRate: "1",
        effectiveFrom: utc("2026-01-01"),
      },
    });

    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Courthouse" },
    });

    context.company.id = company.id;
    context.id = owner.id;
    localId = local.id;
    otherLocalId = otherLocal.id;
    journeymanCraftId = journeyman.id;
    apprenticeCraftId = apprentice.id;
    foreignCraftId = foreign.id;
    jobId = job.id;
    workerId = owner.id;
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({ where: { jobId } });
    await prisma.fringeRateSchedule.deleteMany({
      where: { craftClassificationId: { in: [journeymanCraftId, apprenticeCraftId] } },
    });
    await prisma.apprenticeRatioRule.deleteMany({ where: { unionLocalId: localId } });
    await prisma.companyUnionAgreement.deleteMany({ where: { companyId: context.company.id } });
    await prisma.craftClassification.deleteMany({
      where: { id: { in: [journeymanCraftId, apprenticeCraftId, foreignCraftId] } },
    });
    await prisma.complianceDocument.deleteMany({ where: { companyId: context.company.id } });
    await prisma.job.deleteMany({ where: { companyId: context.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.deleteMany({ where: { id: context.company.id } });
    await prisma.unionLocal.deleteMany({ where: { id: { in: [localId, otherLocalId] } } });
    await prisma.$disconnect();
  });

  it("arrives with no tier and no backfill guess from the name", async () => {
    const crafts = await loadCrafts(context.company.id);
    // "Drywall Apprentice" is only an apprentice to a human reader.
    // Inferring from the string is exactly what the column replaces.
    expect(crafts.every((c) => c.tier === null)).toBe(true);
    expect(crafts).toHaveLength(2);
  });

  it("refuses a classification under a local we hold no agreement with", async () => {
    // CraftClassification carries no companyId, so this join IS the
    // access check.
    const result = await setCraftTier(foreignCraftId, form("JOURNEYMAN"));
    expect(result.ok).toBe(false);
    expect(
      (await prisma.craftClassification.findUniqueOrThrow({ where: { id: foreignCraftId } })).tier,
    ).toBeNull();
  });

  it("records tiers, and keeps an apprentice period only on an apprentice", async () => {
    expect(await setCraftTier(journeymanCraftId, form("JOURNEYMAN"))).toEqual({ ok: true });
    expect(await setCraftTier(apprenticeCraftId, form("APPRENTICE", "3"))).toEqual({ ok: true });

    const apprentice = await prisma.craftClassification.findUniqueOrThrow({
      where: { id: apprenticeCraftId },
    });
    expect(apprentice.tier).toBe("APPRENTICE");
    expect(apprentice.apprenticePeriod).toBe(3);

    // Moving it to journeyman must not leave a stale "period 3" behind.
    await setCraftTier(apprenticeCraftId, form("JOURNEYMAN"));
    expect(
      (await prisma.craftClassification.findUniqueOrThrow({ where: { id: apprenticeCraftId } }))
        .apprenticePeriod,
    ).toBeNull();
    await setCraftTier(apprenticeCraftId, form("APPRENTICE", "3"));
  });

  it("refuses a period that is not a real apprentice period", async () => {
    const result = await setCraftTier(apprenticeCraftId, form("APPRENTICE", "12"));
    expect(result.ok).toBe(false);
  });

  it("computes the remittance per fund from the rate in force", async () => {
    await prisma.timeEntry.create({
      data: {
        jobId,
        employeeUserId: workerId,
        craftClassificationId: journeymanCraftId,
        date: utc("2026-08-17"),
        hours: "8",
      },
    });

    const report = await loadRemittance(context.company.id, "2026-08");
    expect(report.locals).toHaveLength(1);
    expect(report.locals[0].components).toEqual({
      pension: 64,
      vacation: 24,
      healthWelfare: 88,
      training: 8,
    });
    expect(report.total).toBe(184);
    expect(report.filed).toBe(false);
  });

  it("counts hours it cannot price rather than valuing them at zero", async () => {
    // The apprentice classification has no fringe schedule at all.
    await prisma.timeEntry.create({
      data: {
        jobId,
        employeeUserId: workerId,
        craftClassificationId: apprenticeCraftId,
        date: utc("2026-08-17"),
        hours: "2",
      },
    });

    const report = await loadRemittance(context.company.id, "2026-08");
    expect(report.totalHours).toBe(10);
    expect(report.uncomputedHours).toBe(2);
    // Still on the right local's filing, just without money.
    expect(report.locals[0].hours).toBe(10);
    expect(report.total).toBe(184);
  });

  it("sees a filing only when it covers the whole month", async () => {
    const partial = await prisma.complianceDocument.create({
      data: {
        companyId: context.company.id,
        type: "UNION_FRINGE_BENEFIT_FILING",
        partyName: "Trust fund",
        periodStart: utc("2026-08-10"),
        periodEnd: utc("2026-08-20"),
      },
    });
    expect((await loadRemittance(context.company.id, "2026-08")).filed).toBe(false);

    await prisma.complianceDocument.update({
      where: { id: partial.id },
      data: { periodStart: utc("2026-08-01"), periodEnd: utc("2026-08-31") },
    });
    expect((await loadRemittance(context.company.id, "2026-08")).filed).toBe(true);

    await prisma.complianceDocument.delete({ where: { id: partial.id } });
  });

  it("finds the day the ratio was broken", async () => {
    // 8 journeyman hours allow 2.67 apprentice hours; 2 is within.
    let [review] = await loadRatioReviews(context.company.id, "2026-08");
    expect(review.days.find((d) => d.date === "2026-08-17")?.status).toBe("WITHIN");

    await prisma.timeEntry.create({
      data: {
        jobId,
        employeeUserId: workerId,
        craftClassificationId: apprenticeCraftId,
        date: utc("2026-08-18"),
        hours: "8",
      },
    });

    [review] = await loadRatioReviews(context.company.id, "2026-08");
    const tuesday = review.days.find((d) => d.date === "2026-08-18");
    // No journeyman on site that day at all.
    expect(tuesday?.status).toBe("NO_JOURNEYMAN");
    expect(review.summary.offendingDates).toEqual(["2026-08-18"]);
  });

  it("makes a day unjudgeable the moment a tier is cleared, rather than passing it", async () => {
    // The failure this whole column exists to prevent: a job looking
    // compliant because nobody finished the setup.
    await setCraftTier(journeymanCraftId, form(""));

    const [review] = await loadRatioReviews(context.company.id, "2026-08");
    const monday = review.days.find((d) => d.date === "2026-08-17");
    expect(monday?.status).toBe("INCOMPLETE");
    expect(monday?.journeymanHours).toBe(0);
    expect(monday?.unclassifiedHours).toBe(8);

    await setCraftTier(journeymanCraftId, form("JOURNEYMAN"));
    const [restored] = await loadRatioReviews(context.company.id, "2026-08");
    expect(restored.days.find((d) => d.date === "2026-08-17")?.status).toBe("WITHIN");
  });
});
