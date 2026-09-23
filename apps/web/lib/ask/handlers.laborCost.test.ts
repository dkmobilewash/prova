import { describe, expect, it, vi } from "vitest";

/**
 * job_labor_cost, and the one thing that makes its number safe to state.
 *
 * `calculateTimeEntryLaborCost` returns null when an entry has no craft tag
 * or no rate schedule covers its date — it never guesses a rate, which is
 * lib/labor-cost.ts's own rule. So on a half-configured company the WAGE
 * money is real and PARTIAL at the same time, and a total handed over
 * without the share of hours it was drawn from is the same failure
 * job_margin's two coverage ratios exist to prevent: a figure that reads as
 * the answer while most of the work is missing from it.
 *
 * Hours here are deliberately lopsided — 8 priced against 24 unpriced — so
 * a regression that quietly counted unpriced hours as free labour would
 * move the percentage from 25% to 100% rather than by a rounding step.
 *
 * ISSUE #375. This used to hand-roll its own total from
 * `calculateTimeEntryLaborCost` and never added per diem/travel pay, so a
 * job with an allowance logged quoted a LOWER number here than /jobs/[id]
 * showed for the same job. Fixed by routing through
 * `laborCostForRows`/`calculateBurdenedLaborCost` — the same function every
 * other money surface uses — which is why this file now mocks
 * `fringeRateSchedule.findMany` (what `loadFringeSchedulesByCraft` reads)
 * rather than `craftClassification.findMany`, and every TimeEntry fixture
 * carries the full `TIME_ENTRY_COST_SELECT` shape.
 * `handlers.laborCostAgreement.test.ts` is the end-to-end regression that
 * checks this handler's own figure against the job page's own computation
 * for a job with per diem — this file pins the individual pieces.
 */

const SCHEDULE = {
  craftClassificationId: "craft-1",
  baseWage: 40,
  pensionRate: 5,
  vacationRate: null,
  healthWelfareRate: 5,
  trainingRate: null,
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  effectiveTo: null,
};

function entry(overrides: Record<string, unknown>) {
  return {
    lineItemId: null,
    craftClassificationId: null,
    perDiemAmount: null,
    travelPayAmount: null,
    ...overrides,
  };
}

const JOBS = [
  {
    id: "job-1",
    name: "Riverside Medical",
    contact: { name: "Acme GC" },
    timeEntries: [
      // Priced: 8h straight at (40 + 10)/h = 400.
      entry({ hours: 8, payType: "STRAIGHT", date: new Date("2026-06-01T00:00:00.000Z"), craftClassificationId: "craft-1" }),
      // Not priced: no craft tag at all.
      entry({ hours: 16, payType: "STRAIGHT", date: new Date("2026-06-02T00:00:00.000Z") }),
      // Not priced: a craft whose schedule does not cover 2025.
      entry({ hours: 8, payType: "OVERTIME", date: new Date("2025-06-02T00:00:00.000Z"), craftClassificationId: "craft-1" }),
    ],
  },
  {
    id: "job-2",
    name: "Maple Street",
    contact: { name: "Turner" },
    // Every hour unpriced on WAGE (no craft tag) — but $75 of per diem is
    // real, known money that needs no rate schedule. The total must be
    // $75, not null and not $0: "we cannot price the wage" and "this job
    // cost nothing" are different answers, and per diem answers a third
    // question neither of those two covers.
    timeEntries: [
      entry({ hours: 10, payType: "STRAIGHT", date: new Date("2026-06-01T00:00:00.000Z"), perDiemAmount: 75 }),
    ],
  },
  // No hours at all: dropped rather than reported as a zero-cost job.
  { id: "job-3", name: "Harborview", contact: { name: "Skanska" }, timeEntries: [] },
];

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    job: {
      findMany: async () => JOBS,
      // Answers the way the real query does, so the job-name mismatch path
      // is genuinely reachable: a name no job contains returns null.
      findFirst: async ({ where }: { where: { name?: { contains?: string } } }) => {
        const wanted = (where.name?.contains ?? "").toLowerCase();
        return JOBS.some((job) => job.name.toLowerCase().includes(wanted)) ? { id: "job-1" } : null;
      },
    },
    // What loadFringeSchedulesByCraft (lib/fringe-schedules-query.ts) reads
    // — the same query job_margin's fringe lookup uses, now that this
    // handler shares it instead of hand-rolling craftClassification.findMany.
    fringeRateSchedule: {
      findMany: async () => [SCHEDULE],
    },
    // No employer burden recorded, which is the default state and the one
    // these expectations were written against — see lib/employer-burden.ts.
    employerBurdenRate: { findMany: async () => [] },
  },
}));

async function ask(input: Record<string, string> = {}) {
  const { runTool } = await import("./handlers");
  return runTool({ companyId: "company-1", principal: { role: "OWNER", jobFunction: null } }, "job_labor_cost", input);
}

describe("job_labor_cost", () => {
  it("prices only the hours a rate schedule covers, and says what share that was", async () => {
    const rows = (await ask()).data as Array<Record<string, unknown>>;
    const riverside = rows.find((row) => row.job === "Riverside Medical")!;

    // 8h * (40 base + 10 fringe) = 400. The 16h with no craft and the 8h
    // outside the schedule contribute nothing to the money. No allowances
    // on this job, so wageCost carries the whole total.
    expect(riverside.burdenedLaborCost).toBe(400);
    expect(riverside.wageCost).toBe(400);
    expect(riverside.allowanceCost).toBe(0);
    expect(riverside.hoursLogged).toBe(32);
    expect(riverside.hoursPriced).toBe(8);
    // Formatted, never a 0..1 fraction — the 100x mistake issue #103
    // caught on percentComplete.
    expect(riverside.shareOfHoursPriced).toBe("25%");
  });

  it("counts per diem even when every wage hour on the job is unpriced", async () => {
    // The regression #375 was filed over: before the fix this reported
    // null (or, on an earlier reading, $0) for a job that /jobs/[id] shows
    // carrying real per diem dollars.
    const rows = (await ask()).data as Array<Record<string, unknown>>;
    const maple = rows.find((row) => row.job === "Maple Street")!;
    expect(maple.burdenedLaborCost).toBe(75);
    expect(maple.wageCost).toBe(0);
    expect(maple.allowanceCost).toBe(75);
    expect(maple.hoursLogged).toBe(10);
    expect(maple.hoursPriced).toBe(0);
    expect(maple.shareOfHoursPriced).toBe("0%");
  });

  it("carries the unpriced hours in the summary, so the total cannot be read as complete", async () => {
    const result = await ask();
    expect(result.summary).toMatchObject({
      jobsWithHours: 2,
      hoursLogged: 42,
      // 24 unpriced on Riverside + 10 on Maple.
      hoursNotPriced: 34,
      // 400 wage (Riverside) + 75 allowance (Maple) — the summary sums the
      // same total field the rows show, allowances included.
      burdenedLaborCost: 475,
    });
  });

  it("leaves out a job with no hours rather than reporting it as costing nothing", async () => {
    const rows = (await ask()).data as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.job)).not.toContain("Harborview");
  });

  it("says no job matches a typo, rather than reporting no hours on it", async () => {
    // The issue #103 finding-3 distinction, which every job-filtered
    // handler has to make: without it a typo and a genuinely quiet job
    // produce the same sentence, and the typo reads as good news.
    const typo = await ask({ jobName: "Rivrside" });
    expect(typo.unavailable).toBe('No job matches "Rivrside".');
    expect(typo.data).toEqual([]);

    // And the control, so the assertion above is not just "everything is
    // unavailable": the correctly spelled name answers.
    const real = await ask({ jobName: "Riverside" });
    expect(real.unavailable).toBeUndefined();
    expect((real.data as Array<Record<string, unknown>>).map((row) => row.job)).toEqual(["Riverside Medical"]);
  });
});
