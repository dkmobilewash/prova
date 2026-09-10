import { describe, expect, it, vi } from "vitest";

/**
 * Issue #103, finding 1: job_margin used to hand the model
 * `wip.percentComplete` raw — a 0..1 fraction — while /jobs/[id] renders
 * the identical number as `(percentComplete * 100).toFixed(1)}%`. Told
 * "never do arithmetic", the model was left to either read the fraction as
 * the percentage ("0.4% complete") or multiply it itself, which is exactly
 * what the design forbids. A margin figure was wrong by 100x either way.
 *
 * The fix (lib/wip.ts `formatPercentComplete`/`formatCoveragePercent`) is
 * the same function /jobs/[id] now renders through, so this test also
 * pins the one Ask-side number this session could not click through a
 * browser to confirm: that "40.0%" is genuinely what the page shows for a
 * job that is 40% complete by cost. If /jobs/[id]'s own rendering ever
 * changes format, this shares the function and moves with it rather than
 * silently disagreeing.
 */

const JOB = {
  id: "job-1",
  name: "Riverside Medical",
  contact: { name: "Acme GC" },
  lineItems: [
    {
      description: "Framing",
      quantity: 100,
      unitPrice: 10,
      budgetedUnitCost: 3,
      currentEstimatedUnitCost: 4,
      estimatedCostToComplete: null,
      // actualCostToDate = 160, currentEstimatedCost = 400,
      // costToComplete = max(400 - 160, 0) = 240,
      // estimatedCostAtCompletion = 160 + 240 = 400,
      // percentComplete = 160 / 400 = 0.4
      costEntries: [{ amount: 100 }, { amount: 60 }],
    },
  ],
  invoices: [],
};

vi.mock("@prova/db", () => ({
  prisma: {
    job: {
      findMany: async () => [JOB],
    },
  },
}));

async function askJobMargin() {
  const { runTool } = await import("./handlers");
  const result = await runTool(
    { companyId: "company-1", principal: { role: "OWNER", jobFunction: null } },
    "job_margin",
    {},
  );
  return (result.data as Array<Record<string, unknown>>)[0];
}

describe("job_margin percentages", () => {
  it("hands over percentComplete already formatted as the page shows it, not the raw 0..1 fraction", async () => {
    const row = await askJobMargin();
    // The exact bug: the old code returned 0.4 here. The model, forbidden
    // from doing arithmetic, would have had nothing correct to say.
    expect(row.percentComplete).toBe("40.0%");
    expect(row.percentComplete).not.toBe(0.4);
  });

  it("formats the two coverage ratios the same way /jobs/[id]'s amber note does — rounded, no decimal", async () => {
    const row = await askJobMargin();
    expect(row.shareOfValueWithACostEstimate).toBe("100%");
    expect(row.shareOfValueWithAnEarnedRevenueFigure).toBe("100%");
  });
});
