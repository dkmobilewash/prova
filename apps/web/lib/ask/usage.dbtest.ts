import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { ASK_LIMITS, askAllowance, PROVENANCE_OUTCOME, recordAskUsage, usageSummary } from "./usage";

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
    expect(summary).toEqual({
      readable: true,
      questions: 1,
      calls: 1,
      blockedAnswers: 0,
      inputTokens: 100,
      outputTokens: 10,
      byFeature: [{ feature: "ask", label: "Ask", calls: 1, tokens: 110 }],
      byPerson: [{ who: "Usage Tester", calls: 1, tokens: 110 }],
    });
  });

  /**
   * The number-provenance guard's firing rate, against a real `groupBy`.
   *
   * `usage.test.ts` proves the arithmetic over a fake. What only Postgres
   * can answer is whether grouping by a THIRD column still returns the
   * outcome to read it from — and whether the totals beside it, which all
   * sum across groups, survive the extra split. A held-back answer is a
   * question and a model call like any other; only `blockedAnswers` should
   * single it out.
   */
  it("counts an answer the provenance guard held back, without disturbing the totals", async () => {
    const before = await usageSummary(companyId);
    await recordAskUsage({ companyId, userId, model: "claude-opus-5", usage: totals, outcome: PROVENANCE_OUTCOME });
    try {
      const after = await usageSummary(companyId);
      expect(after.blockedAnswers).toBe(before.blockedAnswers + 1);
      // A held-back answer is still a question and still a model call — it
      // cost one and it counts against the limits. Only `blockedAnswers`
      // singles it out.
      expect(after.questions).toBe(before.questions + 1);
      expect(after.calls).toBe(before.calls + 1);
      // One person and one feature still, so the extra grouping column did
      // not split the rows a reader sees into two lines.
      expect(after.byPerson).toHaveLength(1);
      expect(after.byFeature).toHaveLength(1);
    } finally {
      // Put the window back exactly as it was: the cases below this one
      // count rows, and a test that leaves data behind fails the NEXT one.
      await prisma.askUsage.deleteMany({ where: { companyId, outcome: PROVENANCE_OUTCOME } });
    }
    expect((await usageSummary(companyId)).blockedAnswers).toBe(before.blockedAnswers);
  });

  /**
   * The same split as usage.test.ts, but against real rows and a real
   * `groupBy` — the half a fake cannot answer for, since it is Postgres
   * that has to group by two columns and Prisma that has to type it.
   *
   * The assertion that matters is `calls: 3` beside `questions: 1`: the
   * extraction and the narrative ARE part of the bill and are NOT part of
   * the ceiling, and `askAllowance` agreeing on the second half is what
   * keeps the two surfaces honest with each other.
   */
  it("bills every feature and bounds only the questions, read back from real rows", async () => {
    // This suite has beforeAll/afterAll and no per-test reset, so rows
    // carry between cases. Clear at both ends rather than counting on the
    // order: the figures below are exact, and an exact assertion over
    // shared state is a test that passes until somebody inserts a case
    // above it.
    await prisma.askUsage.deleteMany({ where: { companyId } });

    await recordAskUsage({ companyId, userId, model: "claude-opus-5", usage: totals, outcome: "answered" });
    await recordAskUsage({
      companyId, userId, model: "claude-opus-5", usage: totals,
      outcome: "answered", feature: "compliance-extract",
    });
    await recordAskUsage({
      companyId, userId, model: "claude-opus-5", usage: totals,
      outcome: "answered", feature: "wip-narrative",
    });

    const summary = await usageSummary(companyId);
    expect(summary.calls).toBe(3);
    expect(summary.questions).toBe(1);
    expect(summary.byFeature.map((f) => f.feature).sort()).toEqual([
      "ask",
      "compliance-extract",
      "wip-narrative",
    ]);
    // One person, three features, one row on screen.
    expect(summary.byPerson).toEqual([{ who: "Usage Tester", calls: 3, tokens: 330 }]);

    // And the ceiling counted exactly one of them — the same filter, read
    // from the other side, so a change to either is caught here.
    const asked = await prisma.askUsage.count({ where: { companyId, feature: "ask" } });
    expect(asked).toBe(1);

    await prisma.askUsage.deleteMany({ where: { companyId } });
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

  /* ---- the other three model callers, metered since 2026-09-14 ---- */

  /**
   * Three callers in packages/integrations/src/anthropic.ts spent money with
   * no usage row and no ceiling until 2026-09-14, so /settings/assistant
   * showed a number that was not the bill. They write rows now, under their
   * own `feature`.
   *
   * THE SECOND TEST IS THE ONE THAT MATTERS. Putting them in this table must
   * not make the Ask limits count them — otherwise uploading four compliance
   * documents silently costs somebody four of their hourly questions, which
   * is a limit tightening itself as a side effect of a metering change.
   */
  it("records a row under its own feature for a caller that is not Ask", async () => {
    await prisma.askUsage.deleteMany({ where: { companyId } });
    await recordAskUsage({
      companyId, userId, model: "claude-opus-5", usage: totals,
      outcome: "answered", feature: "compliance-extract",
    });
    const row = await prisma.askUsage.findFirst({ where: { companyId } });
    expect(row?.feature).toBe("compliance-extract");
  });

  it("defaults an unlabelled row to ask, so every existing call site is unchanged", async () => {
    await prisma.askUsage.deleteMany({ where: { companyId } });
    await recordAskUsage({ companyId, userId, model: "m", usage: totals, outcome: "answered" });
    const row = await prisma.askUsage.findFirst({ where: { companyId } });
    expect(row?.feature).toBe("ask");
  });

  it("does NOT spend a person's Ask allowance on compliance extractions", async () => {
    await prisma.askUsage.deleteMany({ where: { companyId } });

    // One short of the hourly ceiling, in real Ask rows.
    await prisma.askUsage.createMany({
      data: Array.from({ length: ASK_LIMITS.perPersonPerHour - 1 }, () => ({
        companyId, userId, model: "m", passes: 1, inputTokens: 1, outputTokens: 1,
        cacheReadTokens: 0, cacheWriteTokens: 0, outcome: "answered", feature: "ask",
      })),
    });
    expect((await askAllowance(companyId, userId)).ok).toBe(true);

    // A burst of the expensive non-Ask kind. None of it is a question.
    await prisma.askUsage.createMany({
      data: Array.from({ length: 10 }, () => ({
        companyId, userId, model: "m", passes: 1, inputTokens: 1, outputTokens: 1,
        cacheReadTokens: 0, cacheWriteTokens: 0, outcome: "answered", feature: "compliance-extract",
      })),
    });
    expect(
      (await askAllowance(companyId, userId)).ok,
      "ten compliance uploads took ten of this person's questions",
    ).toBe(true);

    // And one more real question still closes it, so the limit itself works
    // — without this the test would pass on a limit that never fires.
    await recordAskUsage({ companyId, userId, model: "m", usage: totals, outcome: "answered" });
    expect((await askAllowance(companyId, userId)).ok).toBe(false);
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
