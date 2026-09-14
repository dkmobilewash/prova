import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { ASK_LIMITS, askAllowance, recordAskUsage, usageSummary } from "./usage";

/**
 * The bound against a real Postgres: rows written by recordAskUsage are
 * the rows askAllowance counts, in the windows it counts them over, and
 * the summary the settings page shows reads the same rows. A fake cannot
 * prove the two agree; this can.
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
    expect(summary).toEqual({ questions: 1, inputTokens: 100, outputTokens: 10, byPerson: [{ who: "Usage Tester", questions: 1, tokens: 110 }] });
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
});
