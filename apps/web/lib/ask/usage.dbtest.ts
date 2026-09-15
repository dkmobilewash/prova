import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { ASK_LIMITS, askAllowance, recordAskUsage, usageSummary } from "./usage";

/**
 * The bound against a real Postgres: rows written by recordAskUsage are
 * the rows askAllowance counts, in the windows it counts them over, and
 * the summary the settings page shows reads the same rows. A fake cannot
 * prove the two agree; this can.
 *
 * And the #257 case, which is the reason this file is the right place for
 * it: the defect was a MISSING TABLE, and a mocked Prisma rejecting with a
 * hand-made P2021 only proves the catch block runs — it cannot prove that
 * a real Postgres missing this table produces that error at all. So the
 * last case takes the table away for real and puts it back.
 */
let companyId = "";
let userId = "";
const totals = { passes: 1, inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe("ask usage against a real database", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "ASK-USAGE-DBTEST Co" } });
    companyId = company.id;
    const user = await prisma.user.create({
      data: { companyId, clerkId: `ask_u_${Date.now()}`, email: `ask_u_${Date.now()}@example.test`, role: "OWNER", name: "Usage Tester" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.askUsage.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it("a recorded question counts against the person and the company, and the summary reads it back", async () => {
    expect(await askAllowance(companyId, userId)).toEqual({ ok: true });
    await recordAskUsage({ companyId, userId, model: "claude-opus-5", usage: totals, outcome: "answered" });
    const rows = await prisma.askUsage.findMany({ where: { companyId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId, passes: 1, inputTokens: 100, outputTokens: 10, outcome: "answered" });

    const summary = await usageSummary(companyId);
    expect(summary).toEqual({ readable: true, questions: 1, inputTokens: 100, outputTokens: 10, byPerson: [{ who: "Usage Tester", questions: 1, tokens: 110 }] });
  });

  it("refuses the person at the hourly limit and not before, counting only the last hour", async () => {
    // Backdate one row past the hour: it must not count.
    await prisma.askUsage.create({
      data: { companyId, userId, model: "m", passes: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outcome: "answered", createdAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    const inWindow = await prisma.askUsage.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 3_600_000) } } });
    const toAdd = ASK_LIMITS.perPersonPerHour - 1 - inWindow;
    await prisma.askUsage.createMany({
      data: Array.from({ length: toAdd }, () => ({ companyId, userId, model: "m", passes: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outcome: "answered" })),
    });
    expect(await askAllowance(companyId, userId)).toEqual({ ok: true });
    await recordAskUsage({ companyId, userId, model: "m", usage: totals, outcome: "answered" });
    const refused = await askAllowance(companyId, userId);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain(`${ASK_LIMITS.perPersonPerHour} questions in the last hour`);
  });

  /**
   * #257, reproduced rather than simulated. `AskUsage` is renamed out of
   * the way, which is what a database one migration behind looks like to
   * every query in this module, and put back in a finally so a failure
   * here cannot strand the table for the rest of the suite.
   *
   * What it proves that the unit test cannot: that a real Postgres in this
   * state raises the error the catch is written for, and that the
   * assistant answers anyway.
   */
  it("answers unbounded, and says the figures are unreadable, when the table is missing", async () => {
    const error = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => void lines.push(String(args[0]));
    await prisma.$executeRawUnsafe('ALTER TABLE "AskUsage" RENAME TO "AskUsage_257"');
    try {
      // The bound is gone, so the question goes through. Before the fix
      // this threw and the whole stream died on a generic sentence.
      expect(await askAllowance(companyId, userId)).toEqual({ ok: true });

      // The settings page reads unreadable rather than a reassuring zero.
      const summary = await usageSummary(companyId);
      expect(summary.readable).toBe(false);
      expect(summary.questions).toBe(0);

      // Writing is already swallowed (it was before this change); assert it
      // so the two halves are known to degrade together rather than one of
      // them throwing past the other.
      await expect(
        recordAskUsage({ companyId, userId, model: "m", usage: totals, outcome: "answered" }),
      ).resolves.toBeUndefined();

      expect(lines.some((l) => l.includes("unbounded"))).toBe(true);
      expect(lines.some((l) => l.includes("migrate:deploy"))).toBe(true);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "AskUsage_257" RENAME TO "AskUsage"');
      console.error = error;
    }

    // Back to normal: the same calls work again, so the rename really was
    // what the assertions above were reading.
    expect((await usageSummary(companyId)).readable).toBe(true);
  });
});
