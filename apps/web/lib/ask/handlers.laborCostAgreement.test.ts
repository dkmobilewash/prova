import { describe, expect, it, vi } from "vitest";
import { unassignedLaborCost } from "@/lib/labor-job-cost";
import { calculateJobWip } from "@/lib/wip";

/**
 * ISSUE #375 — THE REGRESSION THAT ACTUALLY MATTERS.
 *
 * Not "does job_labor_cost's arithmetic look right in isolation" (that is
 * handlers.laborCost.test.ts) but "does Ask's answer agree with the number
 * /jobs/[id] shows for the SAME job". Two money surfaces disagreeing about
 * one job is the failure a pilot with real subs cannot afford, and it does
 * not matter much which number is right — it matters that they agree and
 * that whichever is shown is explained (see CLAUDE.md's framing of this
 * issue).
 *
 * This does not render the page. It computes the job page's own figure
 * through the SAME functions `/jobs/[id]` and `job_margin` call —
 * `unassignedLaborCost` + `calculateJobWip` from lib/labor-job-cost.ts and
 * lib/wip.ts, un-mocked — and checks it against `job_labor_cost`'s
 * `burdenedLaborCost` for a job whose time entries carry BOTH a wage the
 * schedule can price and a per diem, which is exactly the shape #375 named.
 * No JobLineItem in the fixture and no CostEntry: with an empty lineItems
 * array, `calculateJobWip`'s actualCostToDate is 0 + unassignedLabor.total,
 * i.e. purely the job's burdened labor — so this is the cleanest possible
 * apples-to-apples reading of "the job page's Actual figure" for a job
 * whose only cost is labor.
 *
 * RUN THIS AGAINST THE PRE-FIX HANDLER AND IT FAILS. Before #375, Ask
 * summed only `calculateTimeEntryLaborCost` (wage) and never added
 * `perDiemAmount`/`travelPayAmount`, so its total was $320 (wage only)
 * against the job page's $395 (wage + $75 per diem) — a real, silent
 * disagreement between two screens describing the same job. That is the
 * exact failure mode named in the issue: not a wrong number, but two
 * numbers.
 */

const SCHEDULE = {
  craftClassificationId: "craft-1",
  baseWage: 30,
  pensionRate: 5,
  vacationRate: null,
  healthWelfareRate: 5,
  trainingRate: null,
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  effectiveTo: null,
};

// One job, one craft, a week of hours with per diem on top — the ordinary
// shape a union framing crew actually logs, not a contrived edge case.
const TIME_ENTRIES = [
  // Priced: 8h straight at (30 + 10)/h = 320. $50/day per diem, 4 days.
  {
    lineItemId: null,
    craftClassificationId: "craft-1",
    hours: 8,
    payType: "STRAIGHT" as const,
    date: new Date("2026-06-01T00:00:00.000Z"),
    perDiemAmount: 50,
    travelPayAmount: null,
  },
  {
    lineItemId: null,
    craftClassificationId: "craft-1",
    hours: 0,
    payType: "STRAIGHT" as const,
    date: new Date("2026-06-02T00:00:00.000Z"),
    perDiemAmount: 50,
    travelPayAmount: null,
  },
  {
    lineItemId: null,
    craftClassificationId: "craft-1",
    hours: 0,
    payType: "STRAIGHT" as const,
    date: new Date("2026-06-03T00:00:00.000Z"),
    perDiemAmount: 50,
    travelPayAmount: null,
  },
  {
    lineItemId: null,
    craftClassificationId: "craft-1",
    hours: 0,
    payType: "STRAIGHT" as const,
    date: new Date("2026-06-04T00:00:00.000Z"),
    perDiemAmount: 50,
    travelPayAmount: null,
  },
];
// wageCost = 8h * $40/h = 320. allowanceCost = 4 * $50 = 200.
// total = 520.

const JOB = {
  id: "job-1",
  name: "Union Office Build-Out",
  contact: { name: "Acme GC" },
  timeEntries: TIME_ENTRIES,
};

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    job: {
      findMany: async () => [JOB],
      findFirst: async () => ({ id: "job-1" }),
    },
    fringeRateSchedule: {
      findMany: async () => [SCHEDULE],
    },
    // No employer burden recorded: this file's whole point is that the
    // Ask tool and the job page quote the SAME total, and they must still
    // do so on the default every company starts on.
    employerBurdenRate: { findMany: async () => [] },
    // Also mocked in the OLD craftClassification.findMany shape the
    // pre-#375 handler read its schedules through, purely so this file can
    // be run unmodified against that handler to confirm the numeric
    // disagreement rather than a mock-shape crash. The fixed handler never
    // calls this.
    craftClassification: {
      findMany: async () => [{ id: "craft-1", fringeRateSchedules: [SCHEDULE] }],
    },
  },
}));

describe("job_labor_cost agrees with the job page for a job with per diem", () => {
  it("quotes the same labor total /jobs/[id] would show", async () => {
    const { runTool } = await import("./handlers");
    const askResult = await runTool(
      { companyId: "company-1", principal: { role: "OWNER", jobFunction: null } },
      "job_labor_cost",
      {},
    );
    const askRow = (askResult.data as Array<Record<string, unknown>>)[0];

    // The job page's own computation, through the same shared functions,
    // for a job whose only cost is labor (no line items, no cost entries).
    const schedulesByCraft = new Map([["craft-1", [SCHEDULE]]]);
    const jobPageWip = calculateJobWip(
      [],
      0,
      unassignedLaborCost(JOB.timeEntries, schedulesByCraft),
    );

    expect(jobPageWip.actualCostToDate).toBe(520);
    // THE ASSERTION THAT MATTERS: not that either figure is 520, but that
    // Ask's figure and the job page's figure are the SAME NUMBER for the
    // SAME JOB. This is what must be red against the pre-#375 handler.
    expect(askRow.burdenedLaborCost).toBe(jobPageWip.actualCostToDate);
    expect(askRow.burdenedLaborCost).toBe(520);

    // And the breakdown the tool description promises, so an answer can
    // say "$520, of which $200 is per diem" rather than leaving allowance
    // dollars unexplained inside one number.
    expect(askRow.wageCost).toBe(320);
    expect(askRow.allowanceCost).toBe(200);
  });
});
