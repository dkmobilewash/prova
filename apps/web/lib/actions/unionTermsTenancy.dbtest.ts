import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * TWO companies under ONE shared union local — issue #136.
 *
 * This is the test that never existed, and its absence is why the leak
 * lived on production for as long as it did. Every other union test builds
 * one company, and with one company a query scoped by "the locals you hold
 * an agreement with" and a query scoped by "yours" return the SAME ROWS.
 * The bug is invisible until a second company shares a hall with the first,
 * which is the ordinary case in this trade and was the impossible case in
 * the test suite.
 *
 * The shape being defended: UnionLocal and CraftClassification are GLOBAL
 * on purpose — two contractors under one hall are under the same real
 * local, and ApprenticeshipEnrollment points at it. What is NOT global is
 * the NEGOTIATED TERMS: base wage, pension, vacation, H&W, training, and
 * the apprentice ratio that drives a compliance judgement. Those now carry
 * companyId and every read is scoped to it.
 *
 * Read every assertion below as: company B is a real, innocent contractor
 * who happens to belong to the same hall as company A, and typed a public
 * local number into the app.
 */

const context = { company: { id: "" }, id: "", role: "OWNER" as string };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const {
  createFringeRateSchedule,
  deleteCraftClassification,
  deleteFringeRateSchedule,
  endFringeRateSchedule,
  setApprenticeRatioRule,
} = await import("./unionCompliance");
const { loadRatioReviews, loadRemittance, loadUnionSetup } = await import(
  "@/lib/union-compliance-query"
);

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

/** Whose session the actions run as. Every action reads companyId off the
 * mocked context, so switching companies is switching this. */
function actAs(companyId: string, userId: string) {
  context.company.id = companyId;
  context.id = userId;
  context.role = "OWNER";
}

let companyA = "";
let companyB = "";
let userA = "";
let userB = "";
let sharedLocalId = "";
let sharedCraftId = "";
let jobB = "";
let scheduleA = "";
let ruleA = "";

async function makeCompany(label: string, stamp: number) {
  const company = await prisma.company.create({ data: { name: `Union Tenancy ${label}` } });
  const owner = await prisma.user.create({
    data: {
      companyId: company.id,
      clerkId: `ut_${label}_${stamp}`,
      email: `ut_${label}_${stamp}@example.test`,
      role: "OWNER",
    },
  });
  return { companyId: company.id, userId: owner.id };
}

describe("two companies, one shared union local", () => {
  beforeAll(async () => {
    const stamp = Date.now();
    const a = await makeCompany("A", stamp);
    const b = await makeCompany("B", stamp);
    companyA = a.companyId;
    userA = a.userId;
    companyB = b.companyId;
    userB = b.userId;

    // ONE local. Both companies hold an agreement with it — the same real
    // hall, which is the whole point of leaving UnionLocal global.
    const local = await prisma.unionLocal.create({
      data: {
        parentInternational: "Carpenters",
        localNumber: `tenancy${stamp}`,
        jurisdictionName: "Northern California",
      },
    });
    sharedLocalId = local.id;
    await prisma.companyUnionAgreement.createMany({
      data: [
        { companyId: companyA, unionLocalId: local.id, effectiveFrom: utc("2026-01-01") },
        { companyId: companyB, unionLocalId: local.id, effectiveFrom: utc("2026-01-01") },
      ],
    });

    // ONE classification, shared, as designed.
    const craft = await prisma.craftClassification.create({
      data: { unionLocalId: local.id, name: "Journeyman Drywall", tier: "JOURNEYMAN" },
    });
    sharedCraftId = craft.id;

    // Company A records its negotiated terms THROUGH THE ACTIONS, so the
    // test proves the write path stamps companyId rather than proving a
    // fixture does.
    actAs(companyA, userA);
    expect(
      await createFringeRateSchedule(
        form({
          craftClassificationId: sharedCraftId,
          baseWage: "62.50",
          pensionRate: "9",
          vacationRate: "4",
          healthWelfareRate: "12",
          trainingRate: "1.5",
          effectiveFrom: "2026-01-01",
        }),
      ),
    ).toEqual({ ok: true });
    expect(
      await setApprenticeRatioRule(
        form({
          unionLocalId: sharedLocalId,
          apprenticeCount: "1",
          journeymenCount: "1",
          programStandardReference: "A's standard",
        }),
      ),
    ).toEqual({ ok: true });

    scheduleA = (
      await prisma.fringeRateSchedule.findFirstOrThrow({ where: { companyId: companyA } })
    ).id;
    ruleA = (await prisma.apprenticeRatioRule.findFirstOrThrow({ where: { companyId: companyA } }))
      .id;

    // A job and a day of work for company B, on the shared craft.
    const contact = await prisma.contact.create({ data: { companyId: companyB, name: "GC" } });
    const job = await prisma.job.create({
      data: { companyId: companyB, contactId: contact.id, name: "B's Courthouse" },
    });
    jobB = job.id;
    await prisma.timeEntry.create({
      data: {
        jobId: job.id,
        employeeUserId: userB,
        craftClassificationId: sharedCraftId,
        date: utc("2026-08-17"),
        hours: "8",
      },
    });
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({ where: { jobId: jobB } });
    // By LOCAL, not by the one shared craft: the orphan test adds a second
    // classification under this local, and cleaning up only the craft this
    // file names would leave its schedule behind to trip the foreign key.
    await prisma.fringeRateSchedule.deleteMany({
      where: { craftClassification: { unionLocalId: sharedLocalId } },
    });
    await prisma.apprenticeRatioRule.deleteMany({ where: { unionLocalId: sharedLocalId } });
    await prisma.companyUnionAgreement.deleteMany({
      where: { companyId: { in: [companyA, companyB] } },
    });
    await prisma.craftClassification.deleteMany({ where: { unionLocalId: sharedLocalId } });
    await prisma.job.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
    await prisma.contact.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
    await prisma.user.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
    await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
    await prisma.unionLocal.deleteMany({ where: { id: sharedLocalId } });
    await prisma.$disconnect();
  });

  /* ------------------------------------------------------------ reads */

  it("shows B the shared local and the shared craft, and NONE of A's rates", async () => {
    actAs(companyB, userB);
    const setup = await loadUnionSetup(companyB);

    // The local and the classification ARE shared — that is deliberate,
    // and if this half broke the fix would have gone too far.
    const localRow = setup.find((l) => l.unionLocalId === sharedLocalId);
    expect(localRow).toBeDefined();
    expect(localRow!.crafts.map((c) => c.id)).toContain(sharedCraftId);

    // The money is not.
    expect(localRow!.crafts.find((c) => c.id === sharedCraftId)!.schedules).toEqual([]);
    expect(localRow!.ratio).toBeNull();
  });

  it("still shows A their own rates — scoping is not just hiding everything", async () => {
    actAs(companyA, userA);
    const localRow = (await loadUnionSetup(companyA)).find(
      (l) => l.unionLocalId === sharedLocalId,
    )!;
    const schedules = localRow.crafts.find((c) => c.id === sharedCraftId)!.schedules;
    expect(schedules).toHaveLength(1);
    expect(schedules[0].baseWage).toBe(62.5);
    expect(localRow.ratio).toEqual({
      apprenticeCount: 1,
      journeymenCount: 1,
      programStandardReference: "A's standard",
    });
  });

  it("prices B's remittance at nothing rather than at A's wage", async () => {
    const report = await loadRemittance(companyB, "2026-08");
    // Eight hours were worked and they are REPORTED — not silently valued
    // at zero and not valued at A's $62.50.
    expect(report.totalHours).toBe(8);
    expect(report.uncomputedHours).toBe(8);
    expect(report.total).toBe(0);
  });

  it("judges B's ratio as unjudgeable rather than by A's rule", async () => {
    const reviews = await loadRatioReviews(companyB, "2026-08");
    const review = reviews.find((r) => r.unionLocalId === sharedLocalId);
    expect(review).toBeDefined();
    // A's rule is 1:1. Reading it as B's would produce a real verdict on
    // a real day from a number B never agreed to.
    expect(review!.rule).toBeNull();
  });

  /* ------------------------------------------------------- mutations */

  it("refuses to let B end A's rate schedule", async () => {
    actAs(companyB, userB);
    const result = await endFringeRateSchedule(scheduleA, form({ effectiveTo: "2026-02-01" }));
    expect(result).toEqual({ ok: false, error: "Rate schedule not found" });

    const untouched = await prisma.fringeRateSchedule.findUniqueOrThrow({ where: { id: scheduleA } });
    expect(untouched.effectiveTo).toBeNull();
  });

  it("refuses to let B delete A's rate schedule", async () => {
    actAs(companyB, userB);
    const result = await deleteFringeRateSchedule(scheduleA);
    expect(result).toEqual({ ok: false, error: "Rate schedule not found" });
    expect(await prisma.fringeRateSchedule.count({ where: { id: scheduleA } })).toBe(1);
  });

  it("refuses to let B delete a classification A has rates against", async () => {
    actAs(companyB, userB);
    const result = await deleteCraftClassification(sharedCraftId);
    expect(result.ok).toBe(false);
    // The classification is shared, so this is not B's to remove — and it
    // must not take A's money with it either way.
    expect(await prisma.craftClassification.count({ where: { id: sharedCraftId } })).toBe(1);
    expect(await prisma.fringeRateSchedule.count({ where: { id: scheduleA } })).toBe(1);
  });

  it("does not delete A's ratio rule when B sets their own", async () => {
    actAs(companyB, userB);
    expect(
      await setApprenticeRatioRule(
        form({
          unionLocalId: sharedLocalId,
          apprenticeCount: "1",
          journeymenCount: "5",
          programStandardReference: "B's standard",
        }),
      ),
    ).toEqual({ ok: true });

    // A's rule survived. Before companyId existed, the deleteMany in
    // setApprenticeRatioRule was scoped by the local alone and this saved
    // over another contractor's compliance rule as a side effect.
    const stillA = await prisma.apprenticeRatioRule.findUnique({ where: { id: ruleA } });
    expect(stillA).not.toBeNull();
    expect(stillA!.journeymenCount).toBe(1);

    // And each side reads its own.
    expect((await loadUnionSetup(companyA)).find((l) => l.unionLocalId === sharedLocalId)!.ratio)
      .toMatchObject({ journeymenCount: 1 });
    expect((await loadUnionSetup(companyB)).find((l) => l.unionLocalId === sharedLocalId)!.ratio)
      .toMatchObject({ journeymenCount: 5 });
  });

  it("lets B record their OWN rate for the same craft over the same dates", async () => {
    // The remedy has to actually be available. The non-overlap exclusion
    // constraint was keyed on the classification alone, and the
    // classification is global — so B, told to re-enter their own rates,
    // would have been REFUSED on the strength of A's row, which B is not
    // allowed to see. The migration re-keys it to include companyId.
    actAs(companyB, userB);
    const result = await createFringeRateSchedule(
      form({
        craftClassificationId: sharedCraftId,
        baseWage: "58.00",
        effectiveFrom: "2026-01-01",
      }),
    );
    expect(result).toEqual({ ok: true });

    // Two rows, same craft, same dates, different companies — and each
    // side sees exactly one.
    const aSchedules = (await loadUnionSetup(companyA))
      .find((l) => l.unionLocalId === sharedLocalId)!
      .crafts.find((c) => c.id === sharedCraftId)!.schedules;
    const bSchedules = (await loadUnionSetup(companyB))
      .find((l) => l.unionLocalId === sharedLocalId)!
      .crafts.find((c) => c.id === sharedCraftId)!.schedules;
    expect(aSchedules.map((s) => s.baseWage)).toEqual([62.5]);
    expect(bSchedules.map((s) => s.baseWage)).toEqual([58]);
  });

  it("still refuses a company's own overlapping rate", async () => {
    // The guarantee that mattered is unchanged WITHIN a company: two rates
    // in force at once would make a historical payroll depend on which row
    // was read.
    actAs(companyB, userB);
    const result = await createFringeRateSchedule(
      form({
        craftClassificationId: sharedCraftId,
        baseWage: "59.00",
        effectiveFrom: "2026-06-01",
      }),
    );
    expect(result.ok).toBe(false);
  });

  /* -------------------------------------------------------- orphans */

  it("surfaces an unattributed row as a count, to both, and prices nothing from it", async () => {
    // What the migration's backfill leaves behind: a row under a local
    // with two companies under it, which cannot be attributed without
    // guessing. It must be invisible to EVERYONE — and it must not vanish
    // without trace, or the rates simply disappearing looks like data loss
    // with no explanation.
    const orphanCraft = await prisma.craftClassification.create({
      data: { unionLocalId: sharedLocalId, name: "Legacy Taper" },
    });
    await prisma.fringeRateSchedule.create({
      data: {
        craftClassificationId: orphanCraft.id,
        companyId: null,
        baseWage: "99.99",
        effectiveFrom: utc("2026-01-01"),
      },
    });
    await prisma.apprenticeRatioRule.create({
      data: { unionLocalId: sharedLocalId, companyId: null, apprenticeCount: 1, journeymenCount: 9 },
    });

    for (const companyId of [companyA, companyB]) {
      const localRow = (await loadUnionSetup(companyId)).find(
        (l) => l.unionLocalId === sharedLocalId,
      )!;
      // Counted, so a person can see that something is being held back.
      expect(localRow.unattributed).toEqual({ schedules: 1, ratioRules: 1 });
      // But never priced: no $99.99 anywhere, and no 1:9 ratio.
      expect(localRow.crafts.find((c) => c.id === orphanCraft.id)!.schedules).toEqual([]);
      expect(localRow.ratio?.journeymenCount).not.toBe(9);
    }
  });
});
