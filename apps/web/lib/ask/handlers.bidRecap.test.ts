import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * bid_recap — direct cost in, the number a GC is asked to pay out.
 *
 * THE ORDER OF THE STEPS IS THE BID. Markup per cost type, then escalation,
 * then sales tax on MATERIAL only, then overhead, then profit ON TOP OF
 * overhead, then bond, then contingency — and reordering any two of those
 * changes the number. That is exactly why the model is handed `steps` and
 * `bidTotal` already computed and told never to re-derive them, and why the
 * figures below are worked out here by hand rather than read off the code:
 *
 *   direct           material 2,000 + labor 3,000 + sub 5,000 + uncoded 1,000
 *                    = 11,000
 *   material markup  10% of 2,000            =    200   → 11,200
 *   labor markup     20% of 3,000            =    600   → 11,800
 *   sub markup        5% of 5,000            =    250   → 12,050
 *   sales tax         8% of material AS SOLD =    176   → 12,226   (2,200, not 2,000)
 *   overhead         10% of 12,226           = 1,222.60 → 13,448.60
 *   profit           10% of 13,448.60        = 1,344.86 → 14,793.46
 *
 * Two of those lines are the ones that would silently be wrong another way.
 * The tax is charged on what the material is SOLD at — 2,200 after its own
 * markup, not the 2,000 it cost — and the profit computes on the total
 * INCLUDING overhead, which is the difference between profit-on-cost and
 * profit-on-everything. A profit taken before overhead earns less than the
 * rate says and nothing on screen would show it.
 *
 * Also held still: a rate nobody entered has NO STEP AT ALL rather than a
 * zero-dollar row; an uncoded line is never marked up and is named; and only
 * a job still at ESTIMATE stage has a recap, matching the Estimate tab.
 */

vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-26" }));
vi.mock("@/lib/viewerToday", () => ({
  viewerToday: async () => "2026-09-26",
  viewerTimeZone: async () => "UTC",
}));

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

type Job = {
  id: string;
  companyId: string;
  name: string;
  status: string;
  bidRecap: Record<string, unknown> | null;
  lineItems: { id: string; quantity: string; budgetedUnitCost: string | null; unitPrice: string | null; costCategory: string | null }[];
};

const RIVERSIDE: Job = {
  id: "job-riverside",
  companyId: "company-1",
  name: "Riverside Medical",
  status: "ESTIMATE",
  bidRecap: {
    materialMarkupPercent: "10.00",
    laborMarkupPercent: "20.00",
    subcontractorMarkupPercent: "5.00",
    // Left blank on purpose: an absent rate must produce no step, not a
    // zero-dollar row.
    otherMarkupPercent: null,
    escalationPercent: null,
    materialTaxPercent: "8.00",
    overheadPercent: "10.00",
    profitPercent: "10.00",
    bondPercent: null,
    contingencyPercent: null,
    appliedAt: day("2026-09-22"),
    appliedTotal: "14793.46",
  },
  lineItems: [
    { id: "li-1", quantity: "100.00", budgetedUnitCost: "20.00", unitPrice: "20.00", costCategory: "MATERIAL" },
    { id: "li-2", quantity: "50.00", budgetedUnitCost: "60.00", unitPrice: "60.00", costCategory: "LABOR" },
    { id: "li-3", quantity: "1.00", budgetedUnitCost: "5000.00", unitPrice: "5000.00", costCategory: "SUBCONTRACTOR" },
    // No cost type: carried into the bid at its direct COST, marked up at
    // nothing, and named. ("price" until #512, when the recap stopped reading
    // the sale price as the cost.)
    { id: "li-4", quantity: "1.00", budgetedUnitCost: "1000.00", unitPrice: "1000.00", costCategory: null },
  ],
};

/** No recap of its own, so it is pre-filled from the company's defaults. */
const MAPLE: Job = {
  id: "job-maple",
  companyId: "company-1",
  name: "Maple Street Lofts",
  status: "ESTIMATE",
  bidRecap: null,
  lineItems: [{ id: "li-m", quantity: "10.00", budgetedUnitCost: "100.00", unitPrice: "100.00", costCategory: "MATERIAL" }],
};

/** Estimate stage, nothing priced. Nothing to mark up. */
const EMPTY: Job = {
  id: "job-empty",
  companyId: "company-1",
  name: "Aardvark Lot",
  status: "ESTIMATE",
  bidRecap: null,
  lineItems: [],
};

/** Awarded: the Estimate tab shows no recap, so neither does this. */
const CEDAR: Job = {
  id: "job-cedar",
  companyId: "company-1",
  name: "Cedar Park",
  status: "CONTRACTED",
  bidRecap: { overheadPercent: "99.00" },
  lineItems: [{ id: "li-c", quantity: "1.00", budgetedUnitCost: "999999.00", unitPrice: "999999.00", costCategory: "MATERIAL" }],
};

const OTHERS: Job = {
  id: "job-other",
  companyId: "company-2",
  name: "SOMEONE ELSE'S ESTIMATE",
  status: "ESTIMATE",
  bidRecap: null,
  lineItems: [{ id: "li-x", quantity: "1.00", budgetedUnitCost: "1.00", unitPrice: "1.00", costCategory: "MATERIAL" }],
};

const JOBS = [RIVERSIDE, MAPLE, EMPTY, CEDAR, OTHERS];

const DEFAULTS = {
  materialMarkupPercent: null,
  laborMarkupPercent: null,
  subcontractorMarkupPercent: null,
  otherMarkupPercent: null,
  escalationPercent: null,
  materialTaxPercent: null,
  overheadPercent: "5.00",
  profitPercent: "5.00",
  bondPercent: null,
  contingencyPercent: null,
};

const jobFindMany = vi.fn(
  async ({ where }: { where: { companyId: string; status: string; name?: { contains: string } } }) =>
    JOBS.filter(
      (job) =>
        job.companyId === where.companyId &&
        job.status === where.status &&
        (!where.name || job.name.toLowerCase().includes(where.name.contains.toLowerCase())),
    ).sort((a, b) => a.name.localeCompare(b.name)),
);

const jobFindFirst = vi.fn(async ({ where }: { where: { companyId: string; name?: { contains: string } } }) => {
  const match = JOBS.find(
    (job) =>
      job.companyId === where.companyId &&
      (!where.name || job.name.toLowerCase().includes(where.name.contains.toLowerCase())),
  );
  return match ? { id: match.id } : null;
});

const defaultsFindUnique = vi.fn(async ({ where }: { where: { companyId: string } }) =>
  where.companyId === "company-1" ? DEFAULTS : null,
);

vi.mock("@prova/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@prova/db")>();
  const models: Record<string, unknown> = {
    job: { findMany: jobFindMany, findFirst: jobFindFirst },
    companyBidDefaults: { findUnique: defaultsFindUnique },
  };
  return {
    Prisma: real.Prisma,
    prisma: new Proxy(models, {
      get(_target, key: string) {
        return (
          models[key] ?? {
            findMany: async () => [],
            findFirst: async () => null,
            findUnique: async () => null,
            count: async () => 0,
          }
        );
      },
    }),
  };
});

const OWNER = { role: "OWNER" as const, jobFunction: null };

async function ask(jobName?: string, principal: { role: "OWNER" | "MEMBER"; jobFunction: string | null } = OWNER) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: principal as never }, "bid_recap", { jobName });
}

type Row = {
  job: string;
  ratesFrom: string;
  directCost: {
    material: number;
    labor: number;
    subcontractor: number;
    otherOrEquipment: number;
    notCostCoded: number;
    notCostCodedLineCount: number;
    total: number;
  };
  steps: { step: string; ratePercent: number | null; added: number; runningTotal: number }[];
  bidTotal: number;
  addedOnTopOfDirectCost: number;
  appliedToLinePricesOn: string | null;
  appliedTotal: number | null;
};

const rowsOf = (data: unknown) => (data as { rows: Row[] }).rows;
const rowFor = (rows: Row[], job: string) => rows.find((row) => row.job === job)!;

beforeEach(() => {
  jobFindMany.mockClear();
  jobFindFirst.mockClear();
  defaultsFindUnique.mockClear();
});

describe("bid_recap", () => {
  it("answers only this company's estimate-stage jobs that have something priced", async () => {
    const rows = rowsOf((await ask()).data);
    expect(rows.map((row) => row.job)).toEqual(["Maple Street Lofts", "Riverside Medical"]);
    // Awarded, so the Estimate tab shows no recap and neither does this.
    expect(rows.map((row) => row.job)).not.toContain("Cedar Park");
    // Estimate stage with nothing priced: no direct cost to mark up.
    expect(rows.map((row) => row.job)).not.toContain("Aardvark Lot");
    expect(rows.map((row) => row.job)).not.toContain("SOMEONE ELSE'S ESTIMATE");
    expect(jobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "company-1", status: "ESTIMATE" }) }),
    );
  });

  it("splits direct cost by kind and keeps the uncoded money out of every markup", async () => {
    const riverside = rowFor(rowsOf((await ask("Riverside")).data), "Riverside Medical");
    expect(riverside.directCost).toEqual({
      material: 2000,
      labor: 3000,
      subcontractor: 5000,
      otherOrEquipment: 0,
      notCostCoded: 1000,
      notCostCodedLineCount: 1,
      total: 11000,
    });
    // The uncoded 1,000 is in the total and in NO markup: the three markup
    // steps add 200 + 600 + 250 and not a cent more.
    const markups = riverside.steps.filter((step) => step.step.endsWith("markup"));
    expect(markups.reduce((sum, step) => sum + step.added, 0)).toBe(1050);
  });

  it("walks the steps in the order that makes the bid, with the tax on material AS SOLD", async () => {
    // THE ASSERTION THIS FILE IS FOR — see the header's worked figures.
    const riverside = rowFor(rowsOf((await ask("Riverside")).data), "Riverside Medical");
    expect(riverside.steps).toEqual([
      { step: "Material markup", ratePercent: 10, added: 200, runningTotal: 11200 },
      { step: "Labor markup", ratePercent: 20, added: 600, runningTotal: 11800 },
      { step: "Subcontractor markup", ratePercent: 5, added: 250, runningTotal: 12050 },
      // 8% of 2,200 — the material after its own markup — not 8% of 2,000.
      { step: "Sales tax on material", ratePercent: 8, added: 176, runningTotal: 12226 },
      { step: "Overhead", ratePercent: 10, added: 1222.6, runningTotal: 13448.6 },
      // Profit on the total INCLUDING overhead.
      { step: "Profit", ratePercent: 10, added: 1344.86, runningTotal: 14793.46 },
    ]);
    expect(riverside.bidTotal).toBe(14793.46);
    expect(riverside.addedOnTopOfDirectCost).toBe(3793.46);
  });

  it("leaves out a rate nobody entered rather than showing it as zero", async () => {
    const riverside = rowFor(rowsOf((await ask("Riverside")).data), "Riverside Medical");
    const labels = riverside.steps.map((step) => step.step);
    expect(labels).not.toContain("Escalation");
    expect(labels).not.toContain("Bond premium");
    expect(labels).not.toContain("Contingency");
    // And "Other markup" is absent too, because that category is empty AND
    // its rate is blank — an "Other markup — 0% — $0.00" row tells nobody
    // anything they did not know.
    expect(labels).not.toContain("Other markup");
    expect(riverside.steps).toHaveLength(6);
  });

  it("falls back to the company's default rates and says that is where they came from", async () => {
    const maple = rowFor(rowsOf((await ask()).data), "Maple Street Lofts");
    expect(maple.ratesFrom).toBe("the company's default rates");
    // 1,000 direct, +5% overhead = 1,050, +5% profit on that = 1,102.50.
    expect(maple.steps).toEqual([
      { step: "Overhead", ratePercent: 5, added: 50, runningTotal: 1050 },
      { step: "Profit", ratePercent: 5, added: 52.5, runningTotal: 1102.5 },
    ]);
    expect(maple.bidTotal).toBe(1102.5);
    expect(defaultsFindUnique).toHaveBeenCalledWith({ where: { companyId: "company-1" } });
  });

  it("says when the recap was spread into the line prices, and when it has not been", async () => {
    const rows = rowsOf((await ask()).data);
    expect(rowFor(rows, "Riverside Medical").appliedToLinePricesOn).toBe("2026-09-22");
    expect(rowFor(rows, "Riverside Medical").appliedTotal).toBe(14793.46);
    // Maple has no recap row at all, so nothing has been applied.
    expect(rowFor(rows, "Maple Street Lofts").appliedToLinePricesOn).toBeNull();
    expect(rowFor(rows, "Maple Street Lofts").appliedTotal).toBeNull();
    expect(rowFor(rows, "Riverside Medical").ratesFrom).toBe("this job's own recap");
  });

  it("carries the counts over every job it read", async () => {
    const { summary } = await ask();
    expect(summary).toMatchObject({
      jobsBeingEstimated: 2,
      jobsWithTheirOwnRates: 1,
      linesNotCostCoded: 1,
      recapsAlreadyAppliedToLinePrices: 1,
    });
  });

  it("says there is no direct cost to mark up rather than answering empty", async () => {
    jobFindMany.mockResolvedValueOnce([]);
    const result = await ask();
    expect(result.unavailable).toMatch(/no direct cost to mark up/i);
  });

  it("tells a typo from a job with nothing priced", async () => {
    const result = await ask("Rivrside");
    expect(result.unavailable).toBe('No job matches "Rivrside".');
    expect(jobFindMany).not.toHaveBeenCalled();
  });

  it("is refused to somebody without job-cost access, before any read", async () => {
    const result = await ask(undefined, { role: "MEMBER", jobFunction: "FIELD" });
    expect(result.data).toBeNull();
    expect(jobFindMany).not.toHaveBeenCalled();
    expect(defaultsFindUnique).not.toHaveBeenCalled();
  });
});
