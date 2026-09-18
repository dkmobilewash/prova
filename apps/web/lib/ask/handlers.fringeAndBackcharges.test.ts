import { describe, expect, it, vi } from "vitest";

/**
 * fringe_remittance and backcharge_exposure — the two tools where the thing
 * NOT reported is what does the damage.
 *
 * On the remittance, an hour nobody could price is a hole: no craft tag, or
 * no fringe schedule effective on the day it was worked. Valuing it at zero
 * produces a total that looks like an answer and underpays a fund, which is
 * the one mistake in this registry that costs a member their benefits
 * rather than costing the company a correction. So the unpriced hours and
 * the names behind them are lifted to the top of the result, where an
 * answer cannot be written without meeting them.
 *
 * On backcharges, the date to object by is the point. A backcharge sits in
 * an email thread until it is simply deducted, and the window to dispute it
 * is contractual.
 */

const TODAY = "2026-09-17";

const REMITTANCE = {
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  filed: false,
  totalHours: 1_240,
  total: 37_820.5,
  uncomputedHours: 96,
  uncomputedNames: ["Hector Ramirez", "Tino Alvarez"],
  locals: [
    {
      unionLocalId: "local-1",
      unionLocalLabel: "Carpenters Local 213",
      crafts: [],
      hours: 980,
      components: { pension: 12_000, vacation: 5_400, healthWelfare: 9_800, training: 1_200 },
      total: 28_400,
      uncomputedHours: 96,
    },
    {
      unionLocalId: "local-2",
      unionLocalLabel: "Plasterers Local 200",
      crafts: [],
      hours: 260,
      components: { pension: 4_100, vacation: 1_600, healthWelfare: 3_320.5, training: 400 },
      total: 9_420.5,
      uncomputedHours: 0,
    },
  ],
};

const BACKCHARGES = [
  {
    // Objection window has PASSED. The row that costs money.
    number: 3,
    description: "Cleanup, level 2",
    claimedAmount: 4_250,
    status: "RECEIVED",
    issuedOn: new Date("2026-08-10T00:00:00.000Z"),
    respondByDate: new Date("2026-08-24T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
  },
  {
    number: 4,
    description: "Damaged door frame",
    claimedAmount: 880,
    status: "DISPUTED",
    issuedOn: new Date("2026-09-08T00:00:00.000Z"),
    respondByDate: new Date("2026-09-30T00:00:00.000Z"),
    job: { name: "Riverside Medical" },
  },
  {
    // No date recorded. Not "time left" — unknown.
    number: 5,
    description: "Temporary protection",
    claimedAmount: 1_500,
    status: "RECEIVED",
    issuedOn: new Date("2026-09-12T00:00:00.000Z"),
    respondByDate: null,
    job: { name: "Northgate Apartments" },
  },
  {
    // Closed. Not exposure, even though money moved.
    number: 2,
    description: "Hoist share",
    claimedAmount: 2_000,
    status: "SETTLED",
    issuedOn: new Date("2026-07-01T00:00:00.000Z"),
    respondByDate: new Date("2026-07-15T00:00:00.000Z"),
    job: { name: "Northgate Apartments" },
  },
];

const seenMonths: string[] = [];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    backcharge: { findMany: async () => BACKCHARGES },
    job: {
      findFirst: async ({ where }: { where: { name?: { contains?: string } } }) => {
        const wanted = (where.name?.contains ?? "").toLowerCase();
        return BACKCHARGES.some((b) => b.job.name.toLowerCase().includes(wanted)) ? { id: "job-1" } : null;
      },
    },
  },
}));

vi.mock("@/lib/union-compliance-query", () => ({
  loadRatioReviews: async () => [],
  loadRemittance: async (_companyId: string, month: string) => {
    seenMonths.push(month);
    return REMITTANCE;
  },
}));

vi.mock("@/lib/serverToday", () => ({ serverToday: () => TODAY }));

async function ask(name: "fringe_remittance" | "backcharge_exposure", input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, name, input);
}

describe("fringe_remittance", () => {
  it("LIFTS the unpriced hours to the top, with the people behind them", async () => {
    // The finding. Buried in a per-local detail row, an answer can be
    // written that never mentions them.
    const data = (await ask("fringe_remittance")).data as {
      unpriced: { hours: number; people: string[] };
    };
    expect(data.unpriced.hours).toBe(96);
    expect(data.unpriced.people).toEqual(["Hector Ramirez", "Tino Alvarez"]);
  });

  it("puts the unpriced hours in the summary too, where a count is read from", async () => {
    const result = await ask("fringe_remittance");
    expect(result.summary).toEqual({
      totalHours: 1_240,
      total: 37_820.5,
      unpricedHours: 96,
      locals: 2,
    });
  });

  it("passes the loader's totals through untouched, and reports the gap beside them", async () => {
    // Deliberately NOT arithmetic of my own. The first version of this test
    // computed a figure and asserted it differed from another — which was a
    // tautology that passed on nothing. The real claim is that this handler
    // does no maths: the money is the loader's, and the unpriced hours sit
    // beside it rather than being netted out of it or into it.
    const result = await ask("fringe_remittance");
    expect(result.summary!.total).toBe(37_820.5);
    expect(result.summary!.totalHours).toBe(1_240);
    expect(result.summary!.unpricedHours).toBe(96);

    const data = result.data as { locals: { total: number; uncomputedHours: number }[] };
    expect(data.locals.map((local) => local.total)).toEqual([28_400, 9_420.5]);
    // The local carrying the gap still says so on its own row.
    expect(data.locals[0].uncomputedHours).toBe(96);
  });

  it("breaks the money out by fund component, not as one number", async () => {
    const data = (await ask("fringe_remittance")).data as {
      locals: { unionLocal: string; pension: number; healthWelfare: number; training: number }[];
    };
    expect(data.locals[0]).toMatchObject({
      unionLocal: "Carpenters Local 213",
      pension: 12_000,
      healthWelfare: 9_800,
      training: 1_200,
    });
  });

  it("says whether the month has been filed", async () => {
    const data = (await ask("fringe_remittance")).data as { filed: boolean };
    expect(data.filed).toBe(false);
  });

  it("uses the month the person named, and falls back on one it cannot read", async () => {
    seenMonths.length = 0;
    await ask("fringe_remittance", { month: "2026-07" });
    await ask("fringe_remittance", { month: "July" });
    expect(seenMonths).toEqual(["2026-07", "2026-09"]);
  });
});

describe("backcharge_exposure", () => {
  it("STATES that the objection window has passed", async () => {
    const rows = (await ask("backcharge_exposure")).data as { backcharge: string; pastRespondBy: boolean | null }[];
    expect(rows.find((row) => row.backcharge.startsWith("#3"))!.pastRespondBy).toBe(true);
    expect(rows.find((row) => row.backcharge.startsWith("#4"))!.pastRespondBy).toBe(false);
  });

  it("says null, not false, when no date to object by was recorded", async () => {
    // False would claim there is still time, which nobody knows.
    const rows = (await ask("backcharge_exposure")).data as { backcharge: string; pastRespondBy: boolean | null }[];
    expect(rows.find((row) => row.backcharge.startsWith("#5"))!.pastRespondBy).toBeNull();
  });

  it("counts only what is still ours to answer as exposure", async () => {
    // SETTLED is closed. Its $2,000 is real money and it is not exposure.
    const result = await ask("backcharge_exposure");
    expect(result.summary).toEqual({
      backcharges: 4,
      openBackcharges: 3,
      openClaimedTotal: 4_250 + 880 + 1_500,
      // One OPEN backcharge is past its window (#3). #2's window also
      // lapsed, but it is settled — nothing to act on, so it is not
      // counted here. Writing this test is what found that.
      pastRespondBy: 1,
    });
  });

  it("keeps the settled one in the rows even though it is not exposure", async () => {
    // Dropping it would answer "what has Turner charged back" with a
    // shorter history than the page shows.
    const rows = (await ask("backcharge_exposure")).data as { backcharge: string }[];
    expect(rows.some((row) => row.backcharge.startsWith("#2"))).toBe(true);
  });

  it("distinguishes a job that does not exist from one with no backcharges", async () => {
    const typo = await ask("backcharge_exposure", { jobName: "Rivrside" });
    expect(typo.unavailable).toContain("No job matches");

    const real = await ask("backcharge_exposure", { jobName: "Northgate" });
    expect(real.unavailable).toBeUndefined();
    expect((real.data as { job: string }[]).every((row) => row.job === "Northgate Apartments")).toBe(true);
  });
});
