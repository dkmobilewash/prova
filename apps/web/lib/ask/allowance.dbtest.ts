import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import {
  ASK_MONTHLY_ALLOWANCE,
  allowanceSummary,
  claimAskAllowance,
  markAskAllowanceFailure,
  periodStartFor,
} from "./allowance";

/**
 * THE RACE, AGAINST A REAL POSTGRES. This is the case `allowance.test.ts`
 * says it cannot answer, and the one that decides whether a paid cap is a
 * cap at all.
 *
 * Two questions arrive at the same instant with one unit left. A
 * read-then-decide in JavaScript lets BOTH through — that is the #224
 * shape, where two submits read the same `max(number)` and collided. Here
 * the ceiling is a condition inside the same UPDATE that increments, so
 * under READ COMMITTED the second statement re-evaluates its WHERE against
 * the first's committed row and matches nothing.
 *
 * A fake Prisma returns whatever it was told and can never show this.
 * Neither can one request at a time.
 *
 * Runs with the db suite, which is not CI — `pnpm --filter @prova/web run
 * test:db` against a throwaway local Postgres. `vitest.db.setup.mts`
 * refuses anything that is not one.
 */
let companyId = "";

/** Put this company's month back to a known figure. Only a test does this:
 * nothing in the app ever writes these columns downwards. */
async function setUsed(questionsUsed: number, pagesUsed: number, now = new Date()) {
  const periodStart = periodStartFor(now);
  await prisma.askAllowancePeriod.upsert({
    where: { companyId_periodStart: { companyId, periodStart } },
    create: { companyId, periodStart, questionsUsed, pagesUsed },
    update: { questionsUsed, pagesUsed, failedQuestions: 0, failedPages: 0 },
  });
}

describe("the monthly allowance against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "ASK-ALLOWANCE-DBTEST Co" } });
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.askAllowancePeriod.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it("creates the period row on first use and claims against it", async () => {
    const result = await claimAskAllowance(companyId, { questions: 1, pages: 4 });
    expect(result.ok).toBe(true);
    const row = await prisma.askAllowancePeriod.findFirst({ where: { companyId } });
    expect(row).toMatchObject({ questionsUsed: 1, pagesUsed: 4, failedQuestions: 0, failedPages: 0 });
  });

  it("TWO CONCURRENT ASKS CANNOT BOTH CLAIM THE LAST QUESTION", async () => {
    await setUsed(ASK_MONTHLY_ALLOWANCE.questions - 1, 0);

    // Fired together, not awaited in turn — sequential calls would pass
    // against the broken design too, which is what makes this the only
    // arrangement worth running.
    const [a, b] = await Promise.all([
      claimAskAllowance(companyId, { questions: 1, pages: 0 }),
      claimAskAllowance(companyId, { questions: 1, pages: 0 }),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const refused = a.ok ? b : a;
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("assistant questions");

    // And the ledger agrees: exactly one unit was taken, not two. A cap
    // that refuses one caller and still increments twice has leaked the
    // unit somewhere.
    const row = await prisma.askAllowancePeriod.findFirst({ where: { companyId } });
    expect(row?.questionsUsed).toBe(ASK_MONTHLY_ALLOWANCE.questions);
  });

  it("cannot be overrun by ten at once either", async () => {
    // The pathological case: five units left, ten simultaneous questions.
    await setUsed(ASK_MONTHLY_ALLOWANCE.questions - 5, 0);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => claimAskAllowance(companyId, { questions: 1, pages: 0 })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const row = await prisma.askAllowancePeriod.findFirst({ where: { companyId } });
    expect(row?.questionsUsed).toBe(ASK_MONTHLY_ALLOWANCE.questions);
  });

  it("stops on pages the same way, and a file bigger than the month is refused outright", async () => {
    await setUsed(0, ASK_MONTHLY_ALLOWANCE.pages - 3);
    const tooBig = await claimAskAllowance(companyId, { questions: 1, pages: 10 });
    expect(tooBig.ok).toBe(false);
    // Refused means NOTHING was taken — not the pages and not the question.
    const after = await prisma.askAllowancePeriod.findFirst({ where: { companyId } });
    expect(after).toMatchObject({ questionsUsed: 0, pagesUsed: ASK_MONTHLY_ALLOWANCE.pages - 3 });

    const fits = await claimAskAllowance(companyId, { questions: 1, pages: 3 });
    expect(fits.ok).toBe(true);
    expect(fits.ok && fits.left).toEqual({ questions: ASK_MONTHLY_ALLOWANCE.questions - 1, pages: 0 });
  });

  it("rolls over into a new row at the period edge instead of resetting the old one", async () => {
    const sept = new Date("2026-09-30T23:59:59.000Z");
    const oct = new Date("2026-10-01T00:00:00.000Z");
    await prisma.askAllowancePeriod.deleteMany({ where: { companyId } });

    const septClaim = await claimAskAllowance(companyId, { questions: 1, pages: 7 }, sept);
    expect(septClaim.ok).toBe(true);
    const octClaim = await claimAskAllowance(companyId, { questions: 1, pages: 2 }, oct);
    expect(octClaim.ok).toBe(true);
    // October starts clean and September is untouched — a reset in place
    // would have left one row reading 1 and 2.
    expect(octClaim.ok && octClaim.left).toEqual({
      questions: ASK_MONTHLY_ALLOWANCE.questions - 1,
      pages: ASK_MONTHLY_ALLOWANCE.pages - 2,
    });
    const rows = await prisma.askAllowancePeriod.findMany({
      where: { companyId },
      orderBy: { periodStart: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ questionsUsed: 1, pagesUsed: 7 });
    expect(rows[1]).toMatchObject({ questionsUsed: 1, pagesUsed: 2 });
  });

  it("marks a failed call without handing the unit back", async () => {
    await prisma.askAllowancePeriod.deleteMany({ where: { companyId } });
    const claim = await claimAskAllowance(companyId, { questions: 1, pages: 5 });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    await markAskAllowanceFailure(claim.claim);

    const row = await prisma.askAllowancePeriod.findFirst({ where: { companyId } });
    // USED IS UNCHANGED. If a failure ever gave the unit back, this is
    // where it would show, and the cap would be defeatable by anyone who
    // could make a call fail.
    expect(row).toMatchObject({
      questionsUsed: 1,
      pagesUsed: 5,
      failedQuestions: 1,
      failedPages: 5,
    });

    const summary = await allowanceSummary(companyId);
    expect(summary).toMatchObject({
      readable: true,
      questionsUsed: 1,
      pagesUsed: 5,
      failedQuestions: 1,
      failedPages: 5,
      questionsLeft: ASK_MONTHLY_ALLOWANCE.questions - 1,
      pagesLeft: ASK_MONTHLY_ALLOWANCE.pages - 5,
    });
  });

  /**
   * The #257 case from the other side. The defect was a MISSING TABLE, and
   * a mocked Prisma rejecting with a hand-made P2021 only proves the catch
   * block runs — it cannot prove a real Postgres missing this table lands
   * there. So the table goes away for real, and this cap must REFUSE where
   * `askAllowance` would have answered.
   */
  it("REFUSES for real when the table is genuinely missing, and recovers when it returns", async () => {
    await prisma.askAllowancePeriod.deleteMany({ where: { companyId } });
    await prisma.$executeRawUnsafe('ALTER TABLE "AskAllowancePeriod" RENAME TO "AskAllowancePeriod_hidden"');
    try {
      const refused = await claimAskAllowance(companyId, { questions: 1, pages: 0 });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error).toMatch(/couldn't check your company's monthly AI allowance/);
      expect((await allowanceSummary(companyId)).readable).toBe(false);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "AskAllowancePeriod_hidden" RENAME TO "AskAllowancePeriod"');
    }
    expect((await claimAskAllowance(companyId, { questions: 1, pages: 0 })).ok).toBe(true);
  });
});
