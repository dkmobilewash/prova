import { beforeEach, describe as group, expect, it, vi } from "vitest";

/**
 * `setLineLaborCostFromHours`, pinned where a person cannot click it.
 *
 *   1. The figure is RE-DERIVED on the server. The request carries a line id
 *      and nothing else — no hours, no rate, no cost. This writes the column
 *      the bid recap marks up, so a number from the browser is the one thing
 *      that must not be able to reach it (#105 finding 3).
 *   2. A non-LABOR line is REFUSED. A line carries one cost; writing labor onto
 *      a material line would replace the board cost, not add to it.
 *   3. `currentEstimatedUnitCost` is NEVER touched — it is the PM's live
 *      forecast and this is a screen about the bid.
 *   4. Scoped by job in the where, and refused off the ESTIMATE stage.
 */

type Row = Record<string, unknown> & { id: string };
let db: { jobLineItem: Row[]; job: Row[]; craftClassification: Row[]; employerBurdenRate: Row[] };
let updates: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];

const context = { company: { id: "co_1" }, id: "user_1", role: "OWNER" as string, jobFunction: null as string | null };

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/employer-burden-query", () => ({
  loadEmployerBurdenRates: async () => db.employerBurdenRate,
}));

const matches = (row: Row, where: Record<string, unknown> = {}): boolean =>
  Object.entries(where).every(([key, value]) => row[key] === value);

vi.mock("@prova/db", () => ({
  prisma: {
    job: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        db.job.find((row) => matches(row, where)) ?? null,
    },
    jobLineItem: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const line = db.jobLineItem.find((row) => matches(row, where));
        if (!line) return null;
        return { ...line, job: db.job.find((j) => j.id === line.jobId) };
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updates.push(args);
        const hit = db.jobLineItem.filter((row) => matches(row, args.where));
        for (const row of hit) Object.assign(row, args.data);
        return { count: hit.length };
      },
    },
    craftClassification: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        db.craftClassification.find((row) => matches(row, where)) ?? null,
    },
  },
}));

const actions = () => import("./bidRecap");

const schedule = {
  baseWage: "50",
  pensionRate: "5",
  vacationRate: "3",
  healthWelfareRate: "10",
  trainingRate: "2", // fringe total $20/hr
  effectiveFrom: new Date("2026-01-01"),
  effectiveTo: null,
};

beforeEach(() => {
  updates = [];
  db = {
    job: [{ id: "job_1", companyId: "co_1", status: "ESTIMATE", startDate: new Date("2026-03-01") }],
    craftClassification: [{ id: "craft_1", companyId: "co_1", fringeRateSchedules: [schedule] }],
    employerBurdenRate: [],
    jobLineItem: [
      {
        id: "line_1",
        jobId: "job_1",
        isDeleted: false,
        quantity: "100",
        laborHours: "80",
        productionRate: null,
        budgetedUnitCost: null,
        currentEstimatedUnitCost: null,
        costCategory: "LABOR",
        craftClassificationId: "craft_1",
      },
    ],
  };
});

group("it writes a figure the request could not have sent", () => {
  it("derives the per-unit cost from the hours and the craft's own schedule", async () => {
    // 80 hrs x ($50 + $20) = $5,600 over 100 units = $56.00/unit. Nothing in
    // the call says 56, 5600, 80 or 70 — only "line_1".
    const { setLineLaborCostFromHours } = await actions();
    const result = await setLineLaborCostFromHours("job_1", "line_1");

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual({ unitCost: 56, hours: 80 });
    expect(db.jobLineItem[0].budgetedUnitCost).toBe("56.00");
  });

  it("NEVER touches currentEstimatedUnitCost", async () => {
    // The PM's live forecast. `setLineBudgetedCost` states the rule and this
    // follows it: re-deriving a forecast from a screen about the bid would
    // overwrite a number that diverges from the budget on purpose.
    const { setLineLaborCostFromHours } = await actions();
    await setLineLaborCostFromHours("job_1", "line_1");

    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0].data)).toEqual(["budgetedUnitCost"]);
    expect(db.jobLineItem[0].currentEstimatedUnitCost).toBeNull();
  });

  it("scopes the write by job, so a line id alone cannot reach another job", async () => {
    const { setLineLaborCostFromHours } = await actions();
    await setLineLaborCostFromHours("job_1", "line_1");
    expect(updates[0].where).toMatchObject({ id: "line_1", jobId: "job_1", isDeleted: false });
  });

  it("carries the employer burden when the company has recorded one", async () => {
    // 15% of the $4,000 base = $600, so $6,200 over 100 = $62.00. The rate is
    // read server-side at the job's labor rate date, never sent.
    db.employerBurdenRate = [{ id: "b1", effectiveDate: "2026-01-01", percent: "15.000" }];
    const { setLineLaborCostFromHours } = await actions();
    const result = await setLineLaborCostFromHours("job_1", "line_1");
    expect(result.ok && result.value.unitCost).toBe(62);
  });
});

group("it refuses rather than writing the wrong thing", () => {
  it("REFUSES A NON-LABOR LINE, and writes nothing", async () => {
    db.jobLineItem[0].costCategory = "MATERIAL";
    const { setLineLaborCostFromHours } = await actions();
    const result = await setLineLaborCostFromHours("job_1", "line_1");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("replace");
    expect(updates).toHaveLength(0);
    expect(db.jobLineItem[0].budgetedUnitCost).toBeNull();
  });

  it("refuses a job that is no longer at the estimate stage", async () => {
    db.job[0].status = "CONTRACTED";
    const { setLineLaborCostFromHours } = await actions();
    const result = await setLineLaborCostFromHours("job_1", "line_1");
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("refuses a line that has gone", async () => {
    const { setLineLaborCostFromHours } = await actions();
    const result = await setLineLaborCostFromHours("job_1", "line_gone");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("no longer on the estimate");
    expect(updates).toHaveLength(0);
  });

  it("refuses when the line's craft has no schedule for the date, rather than guessing", async () => {
    db.craftClassification[0].fringeRateSchedules = [];
    const { setLineLaborCostFromHours } = await actions();
    const result = await setLineLaborCostFromHours("job_1", "line_1");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("No fringe rate schedule");
    expect(updates).toHaveLength(0);
  });

  it("refuses a line with no craft at all", async () => {
    // No craft means no schedule means no rate — and the action must not fall
    // back to some other craft's wages.
    db.jobLineItem[0].craftClassificationId = null;
    const { setLineLaborCostFromHours } = await actions();
    const result = await setLineLaborCostFromHours("job_1", "line_1");
    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("refuses a capability it does not have, before reading anything", async () => {
    const previous = context.jobFunction;
    context.jobFunction = "FIELD";
    context.role = "MEMBER";
    try {
      const { setLineLaborCostFromHours } = await actions();
      const result = await setLineLaborCostFromHours("job_1", "line_1");
      expect(result.ok).toBe(false);
      expect(updates).toHaveLength(0);
    } finally {
      context.jobFunction = previous;
      context.role = "OWNER";
    }
  });
});
