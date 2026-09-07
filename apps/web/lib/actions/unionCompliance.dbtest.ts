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

const {
  createCraftClassification,
  createFringeRateSchedule,
  createUnionLocalAndAgreement,
  deleteCraftClassification,
  endFringeRateSchedule,
  endUnionAgreement,
  setApprenticeRatioRule,
  setCraftTier,
} = await import("./unionCompliance");
const { loadCrafts, loadRatioReviews, loadRemittance, loadUnionSetup } = await import(
  "@/lib/union-compliance-query"
);

function form2(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

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

/**
 * The setup CRUD, end to end.
 *
 * This is the gap the feature shipped with: the reports read five tables
 * and not one of them had a create action, so on a real account both
 * sections rendered empty with no way in. The test that matters is not
 * "the action returned ok" — it is that a company starting from NOTHING
 * can reach a priced remittance and a judged ratio using only these
 * actions.
 */
describe("union setup CRUD, from an empty company", () => {
  const ctx = { company: { id: "" }, id: "", role: "OWNER" as string };
  let setupJobId = "";
  let stamp = 0;

  beforeAll(async () => {
    stamp = Date.now();
    const company = await prisma.company.create({ data: { name: "Union Setup Test Co" } });
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `us_${stamp}`,
        email: `us_${stamp}@example.test`,
        role: "OWNER",
      },
    });
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Setup Job" },
    });
    ctx.company.id = company.id;
    ctx.id = owner.id;
    setupJobId = job.id;

    context.company.id = company.id;
    context.id = owner.id;
    context.role = "OWNER";
  });

  afterAll(async () => {
    const locals = await prisma.unionLocal.findMany({
      where: { parentInternational: { in: [`ZZ Carpenters ${stamp}`, `ZZ Plasterers ${stamp}`] } },
      select: { id: true },
    });
    const localIds = locals.map((l) => l.id);
    await prisma.timeEntry.deleteMany({ where: { jobId: setupJobId } });
    await prisma.fringeRateSchedule.deleteMany({
      where: { craftClassification: { unionLocalId: { in: localIds } } },
    });
    await prisma.apprenticeRatioRule.deleteMany({ where: { unionLocalId: { in: localIds } } });
    await prisma.craftClassification.deleteMany({ where: { unionLocalId: { in: localIds } } });
    await prisma.companyUnionAgreement.deleteMany({ where: { companyId: ctx.company.id } });
    await prisma.job.deleteMany({ where: { companyId: ctx.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: ctx.company.id } });
    await prisma.user.deleteMany({ where: { companyId: ctx.company.id } });
    await prisma.company.deleteMany({ where: { id: ctx.company.id } });
    await prisma.unionLocal.deleteMany({ where: { id: { in: localIds } } });
  });

  const localForm = (over: Record<string, string> = {}) =>
    form2({
      parentInternational: `ZZ Carpenters ${stamp}`,
      localNumber: "300",
      jurisdictionName: "Northern California",
      effectiveFrom: "2026-01-01",
      ...over,
    });

  it("records a local and the agreement together", async () => {
    expect(await createUnionLocalAndAgreement(localForm())).toEqual({ ok: true });
    const setup = await loadUnionSetup(ctx.company.id);
    expect(setup).toHaveLength(1);
    expect(setup[0].localNumber).toBe("300");
    // Without the agreement the local would be invisible to this company,
    // which reads as the save having failed.
    expect(setup[0].agreementId).toBeTruthy();
  });

  it("refuses a second current agreement with the same local", async () => {
    const result = await createUnionLocalAndAgreement(localForm());
    expect(result.ok).toBe(false);
  });

  it("adopts a local another company already recorded, rather than rejecting it", async () => {
    // UnionLocal is global and unique on (parentInternational, localNumber).
    // Two contractors under the same hall are under the same real local; a
    // duplicate-key error here would tell someone a true fact is taken.
    const other = await prisma.company.create({ data: { name: "Other Contractor" } });
    const before = await prisma.unionLocal.count({
      where: { parentInternational: `ZZ Carpenters ${stamp}` },
    });

    context.company.id = other.id;
    try {
      expect(await createUnionLocalAndAgreement(localForm())).toEqual({ ok: true });
    } finally {
      context.company.id = ctx.company.id;
    }

    expect(
      await prisma.unionLocal.count({ where: { parentInternational: `ZZ Carpenters ${stamp}` } }),
    ).toBe(before);
    await prisma.companyUnionAgreement.deleteMany({ where: { companyId: other.id } });
    await prisma.company.delete({ where: { id: other.id } });
  });

  it("adds classifications and refuses a duplicate name under the same local", async () => {
    const [local] = await loadUnionSetup(ctx.company.id);
    const add = (name: string, tier: string, period = "") =>
      createCraftClassification(
        form2({ unionLocalId: local.unionLocalId, name, tier, apprenticePeriod: period }),
      );

    expect(await add("Journeyman Drywall", "JOURNEYMAN")).toEqual({ ok: true });
    expect(await add("Drywall Apprentice", "APPRENTICE", "3")).toEqual({ ok: true });

    const dup = await add("Journeyman Drywall", "JOURNEYMAN");
    expect(dup.ok).toBe(false);
    expect(dup.ok === false && dup.error).toContain("already exists");
  });

  it("replaces the ratio rule rather than adding a second", async () => {
    // Several rows per local would make the ratio depend on row order.
    const [local] = await loadUnionSetup(ctx.company.id);
    const set = (a: string, j: string) =>
      setApprenticeRatioRule(
        form2({ unionLocalId: local.unionLocalId, apprenticeCount: a, journeymenCount: j }),
      );

    expect(await set("1", "5")).toEqual({ ok: true });
    expect(await set("1", "3")).toEqual({ ok: true });

    expect(await prisma.apprenticeRatioRule.count({ where: { unionLocalId: local.unionLocalId } })).toBe(1);
    const [after] = await loadUnionSetup(ctx.company.id);
    expect(after.ratio).toMatchObject({ apprenticeCount: 1, journeymenCount: 3 });
  });

  it("records a rate and refuses one that overlaps it, in words", async () => {
    // The exclusion constraint is raw SQL Prisma knows nothing about, so
    // without translation this surfaces as an untyped P2010 and 500s.
    const [local] = await loadUnionSetup(ctx.company.id);
    const craft = local.crafts.find((c) => c.name === "Journeyman Drywall")!;
    const rate = (over: Record<string, string> = {}) =>
      createFringeRateSchedule(
        form2({
          craftClassificationId: craft.id,
          baseWage: "45",
          pensionRate: "8",
          vacationRate: "3",
          healthWelfareRate: "11",
          trainingRate: "1",
          effectiveFrom: "2026-01-01",
          ...over,
        }),
      );

    expect(await rate()).toEqual({ ok: true });

    const overlapping = await rate({ effectiveFrom: "2026-06-01", baseWage: "48" });
    expect(overlapping.ok).toBe(false);
    expect(overlapping.ok === false && overlapping.error).toContain("already covers part of those dates");
  });

  it("lets the next rate start once the current one is ended", async () => {
    const [local] = await loadUnionSetup(ctx.company.id);
    const craft = local.crafts.find((c) => c.name === "Journeyman Drywall")!;
    const open = craft.schedules.find((s) => s.effectiveTo === null)!;

    expect(await endFringeRateSchedule(open.id, form2({ effectiveTo: "2026-05-31" }))).toEqual({ ok: true });
    expect(
      await createFringeRateSchedule(
        form2({
          craftClassificationId: craft.id,
          baseWage: "48",
          pensionRate: "9",
          effectiveFrom: "2026-06-01",
        }),
      ),
    ).toEqual({ ok: true });

    const [after] = await loadUnionSetup(ctx.company.id);
    expect(after.crafts.find((c) => c.id === craft.id)!.schedules).toHaveLength(2);
  });

  it("produces a priced remittance and a judged ratio from setup alone", async () => {
    // The whole point. Before this CRUD existed, a real account could not
    // reach either of these figures at all.
    const [local] = await loadUnionSetup(ctx.company.id);
    const journeyman = local.crafts.find((c) => c.name === "Journeyman Drywall")!;
    const apprentice = local.crafts.find((c) => c.name === "Drywall Apprentice")!;

    await prisma.timeEntry.createMany({
      data: [
        {
          jobId: setupJobId,
          employeeUserId: ctx.id,
          craftClassificationId: journeyman.id,
          date: new Date("2026-08-17T00:00:00.000Z"),
          hours: "8",
        },
        {
          jobId: setupJobId,
          employeeUserId: ctx.id,
          craftClassificationId: apprentice.id,
          date: new Date("2026-08-17T00:00:00.000Z"),
          hours: "8",
        },
      ],
    });

    const remittance = await loadRemittance(ctx.company.id, "2026-08");
    // The rate in force in AUGUST is the June-onward one created above
    // (pension 9, the other funds not contributed to), not the January one
    // that was ended at 31 May. 9 x 8 hours = 72. If this ever reads 184 —
    // the January rate's total — effective dating has stopped working and
    // a historical payroll would be recomputing at today's rate.
    expect(remittance.total).toBe(72);
    expect(remittance.locals[0].components).toMatchObject({
      pension: 72,
      vacation: 0,
      healthWelfare: 0,
      training: 0,
    });
    // The apprentice has no rate, so its hours are counted and unpriced.
    expect(remittance.uncomputedHours).toBe(8);
    expect(remittance.totalHours).toBe(16);

    const [review] = await loadRatioReviews(ctx.company.id, "2026-08");
    const day = review.days.find((d) => d.date === "2026-08-17")!;
    // 1:3 allows 2.67 apprentice hours against 8 journeyman hours.
    expect(day.status).toBe("OVER");
    expect(day.allowedApprenticeHours).toBe(2.67);
  });

  it("refuses to delete a classification that work is tagged with, and says how much", async () => {
    const [local] = await loadUnionSetup(ctx.company.id);
    const journeyman = local.crafts.find((c) => c.name === "Journeyman Drywall")!;

    const result = await deleteCraftClassification(journeyman.id);
    expect(result.ok).toBe(false);
    // The FK alone would throw a raw error production redacts to a digest.
    expect(result.ok === false && result.error).toContain("1 of your records is tagged");
    // "1 time entries" shipped. This is the message an inspector-facing
    // user reads carefully, so the plural is pinned rather than trusted.
    expect(result.ok === false && result.error).toContain("1 time entry");
    expect(result.ok === false && result.error).not.toContain("1 time entries");
    expect(result.ok === false && result.error).toContain("0 line items");
  });

  it("deletes an unused classification along with its rates", async () => {
    const [local] = await loadUnionSetup(ctx.company.id);
    expect(
      await createCraftClassification(
        form2({ unionLocalId: local.unionLocalId, name: "Unused Classification", tier: "JOURNEYMAN" }),
      ),
    ).toEqual({ ok: true });

    const [withUnused] = await loadUnionSetup(ctx.company.id);
    const unused = withUnused.crafts.find((c) => c.name === "Unused Classification")!;
    await createFringeRateSchedule(
      form2({ craftClassificationId: unused.id, baseWage: "40", effectiveFrom: "2026-01-01" }),
    );

    expect(await deleteCraftClassification(unused.id)).toEqual({ ok: true });
    expect(await prisma.craftClassification.findUnique({ where: { id: unused.id } })).toBeNull();
    expect(
      await prisma.fringeRateSchedule.count({ where: { craftClassificationId: unused.id } }),
    ).toBe(0);
  });

  it("refuses a non-owner deleting, and a local nobody holds an agreement with", async () => {
    const [local] = await loadUnionSetup(ctx.company.id);
    const craft = local.crafts[0];

    context.role = "MEMBER";
    try {
      const result = await deleteCraftClassification(craft.id);
      expect(result.ok).toBe(false);
    } finally {
      context.role = "OWNER";
    }

    const foreignLocal = await prisma.unionLocal.create({
      data: {
        parentInternational: `ZZ Plasterers ${stamp}`,
        localNumber: "999",
        jurisdictionName: "Elsewhere",
      },
    });
    const result = await createCraftClassification(
      form2({ unionLocalId: foreignLocal.id, name: "Nope", tier: "JOURNEYMAN" }),
    );
    expect(result).toEqual({
      ok: false,
      error: "That local isn't one you hold an agreement with",
    });
  });

  it("ends an agreement instead of deleting it", async () => {
    const [local] = await loadUnionSetup(ctx.company.id);
    expect(await endUnionAgreement(local.agreementId, form2({ effectiveTo: "2026-12-31" }))).toEqual({
      ok: true,
    });
    const [after] = await loadUnionSetup(ctx.company.id);
    // Still there — payroll filed under it has to stay explainable.
    expect(after.effectiveTo).toBe("2026-12-31");
  });
});

/**
 * The cross-company disclosure on a shared classification.
 *
 * `CraftClassification` hangs off `UnionLocal`, which is global and
 * deliberately so — two contractors signatory to the same hall mean the
 * same local. What that makes easy to get wrong is counting: a relation
 * count on a global row counts EVERY company's rows, and the setup page
 * renders it as this company's "N records tagged".
 *
 * These build two contractors under one local, give only the second one
 * work, and assert the first one can neither read nor be told the second
 * one's numbers. Unfiltered counts pass every other test in this file.
 */
describe("two contractors under one local", () => {
  const ctx2 = { company: { id: "" }, id: "", role: "OWNER" as string };
  let stamp2 = 0;
  let sharedLocalId = "";
  let sharedCraftId = "";
  let aCompanyId = "";
  let bCompanyId = "";
  let aUserId = "";
  let bUserId = "";
  let aJobId = "";
  let bJobId = "";

  // Deliberately uneven, and none of them 1 — a message that leaks B's
  // figures leaks recognisable numbers rather than something that could
  // be a coincidence.
  const B_TIME_ENTRIES = 3;
  const B_LINE_ITEMS = 2;
  const B_CATALOG_ENTRIES = 4;
  const B_DISPATCH_SLIPS = 2;
  const B_TOTAL = B_TIME_ENTRIES + B_LINE_ITEMS + B_CATALOG_ENTRIES + B_DISPATCH_SLIPS; // 11

  async function contractor(name: string) {
    const company = await prisma.company.create({ data: { name: `${name} ${stamp2}` } });
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `${name}_${stamp2}`,
        email: `${name}_${stamp2}@example.test`,
        role: "OWNER",
      },
    });
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: `${name} Job` },
    });
    await prisma.companyUnionAgreement.create({
      data: {
        companyId: company.id,
        unionLocalId: sharedLocalId,
        effectiveFrom: utc("2026-01-01"),
      },
    });
    return { companyId: company.id, userId: owner.id, jobId: job.id };
  }

  beforeAll(async () => {
    stamp2 = Date.now();
    const local = await prisma.unionLocal.create({
      data: {
        parentInternational: `ZZ Shared ${stamp2}`,
        localNumber: "300",
        jurisdictionName: "Northern California",
      },
    });
    sharedLocalId = local.id;
    const craft = await prisma.craftClassification.create({
      data: { unionLocalId: local.id, name: "Journeyman Taper" },
    });
    sharedCraftId = craft.id;

    const a = await contractor("acme");
    const b = await contractor("borden");
    aCompanyId = a.companyId;
    aUserId = a.userId;
    aJobId = a.jobId;
    bCompanyId = b.companyId;
    bUserId = b.userId;
    bJobId = b.jobId;

    // Only B does any work. A's page must show nothing.
    await prisma.timeEntry.createMany({
      data: Array.from({ length: B_TIME_ENTRIES }, (_, i) => ({
        jobId: bJobId,
        employeeUserId: bUserId,
        craftClassificationId: sharedCraftId,
        date: utc("2026-08-17"),
        hours: `${i + 1}`,
      })),
    });
    await prisma.jobLineItem.createMany({
      data: Array.from({ length: B_LINE_ITEMS }, (_, i) => ({
        jobId: bJobId,
        craftClassificationId: sharedCraftId,
        description: `Borden line ${i}`,
      })),
    });
    await prisma.lineItemCatalogEntry.createMany({
      data: Array.from({ length: B_CATALOG_ENTRIES }, (_, i) => ({
        companyId: bCompanyId,
        craftClassificationId: sharedCraftId,
        description: `Borden catalog ${i}`,
      })),
    });
    await prisma.dispatchSlip.createMany({
      data: Array.from({ length: B_DISPATCH_SLIPS }, () => ({
        jobId: bJobId,
        employeeUserId: bUserId,
        craftClassificationId: sharedCraftId,
        dispatchDate: utc("2026-08-17"),
      })),
    });

    ctx2.company.id = aCompanyId;
    ctx2.id = aUserId;
  });

  afterAll(async () => {
    const companyIds = [aCompanyId, bCompanyId];
    const jobIds = [aJobId, bJobId];
    await prisma.timeEntry.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobLineItem.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.dispatchSlip.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.lineItemCatalogEntry.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.companyUnionAgreement.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.job.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.contact.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.craftClassification.deleteMany({ where: { id: sharedCraftId } });
    await prisma.unionLocal.deleteMany({ where: { id: sharedLocalId } });
  });

  it("counts only the viewing company's records, not every contractor's under the local", async () => {
    const [bView] = await loadUnionSetup(bCompanyId);
    const bCraft = bView.crafts.find((c) => c.id === sharedCraftId)!;
    expect(bCraft.usageCount).toBe(B_TOTAL);

    // The one that matters. An unfiltered _count reads 11 here — Borden's
    // headcount and catalog size, on Acme's page, reached by typing a
    // public local number.
    const [aView] = await loadUnionSetup(aCompanyId);
    const aCraft = aView.crafts.find((c) => c.id === sharedCraftId)!;
    expect(aCraft.usageCount).toBe(0);
  });

  it("still refuses Acme's delete, and does so without naming Borden's numbers", async () => {
    context.company.id = aCompanyId;
    context.id = aUserId;
    context.role = "OWNER";

    const result = await deleteCraftClassification(sharedCraftId);

    // The guard stays GLOBAL on purpose: letting Acme delete a craft that
    // Borden has costed work tagged with would be a cross-company
    // destructive action, which is worse than the read leak.
    expect(result.ok).toBe(false);
    expect(await prisma.craftClassification.count({ where: { id: sharedCraftId } })).toBe(1);

    const error = result.ok === false ? result.error : "";
    expect(error).toContain("another contractor");
    // No count of any kind. The old message read "11 records are tagged
    // (3 time entries, 2 line items, 4 catalog entries, 2 dispatch slips)".
    expect(error).not.toMatch(/\d/);
    expect(error).not.toContain("Borden");
  });

  it("quotes Acme's own numbers once Acme has work tagged", async () => {
    await prisma.timeEntry.create({
      data: {
        jobId: aJobId,
        employeeUserId: aUserId,
        craftClassificationId: sharedCraftId,
        date: utc("2026-08-18"),
        hours: "8",
      },
    });

    const [aView] = await loadUnionSetup(aCompanyId);
    expect(aView.crafts.find((c) => c.id === sharedCraftId)!.usageCount).toBe(1);

    context.company.id = aCompanyId;
    context.id = aUserId;
    context.role = "OWNER";
    const result = await deleteCraftClassification(sharedCraftId);

    expect(result.ok).toBe(false);
    const error = result.ok === false ? result.error : "";
    expect(error).toContain("1 of your records is tagged");
    expect(error).toContain("1 time entry");
    // Acme's own zeroes, not Borden's totals. 4 catalog entries and 2
    // dispatch slips exist under this craft; neither belongs to Acme.
    expect(error).toContain("0 catalog entries");
    expect(error).toContain("0 dispatch slips");
    expect(error).not.toContain(`${B_TOTAL}`);
  });
});
