import { describe, expect, it } from "vitest";
import {
  LABOR_ALLOWANCES_IN_JOB_COST,
  calculateBurdenedLaborCost,
  lineItemCostToDate,
  unassignedLaborCost,
  type TimeEntryCostRow,
} from "./labor-job-cost";
import type { FringeRateScheduleInput } from "./labor-cost";
import { calculateJobWip, calculateLineItemWip } from "./wip";

/** Journeyman drywall: $45 base, $23/hr of fringes. Straight time is
 * therefore $68/hr, which is the number every expectation below is built
 * from by hand rather than by re-running the code under test. */
const JOURNEYMAN = "craft_jw";
const schedule = (over: Partial<FringeRateScheduleInput> = {}): FringeRateScheduleInput => ({
  baseWage: 45,
  pensionRate: 8,
  vacationRate: 3,
  healthWelfareRate: 11,
  trainingRate: 1,
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  effectiveTo: null,
  ...over,
});

const schedules = new Map<string, FringeRateScheduleInput[]>([[JOURNEYMAN, [schedule()]]]);

const entry = (over: Partial<TimeEntryCostRow> = {}): TimeEntryCostRow => ({
  lineItemId: "line_1",
  craftClassificationId: JOURNEYMAN,
  date: new Date("2026-03-02T00:00:00.000Z"),
  hours: 8,
  payType: "STRAIGHT",
  perDiemAmount: null,
  travelPayAmount: null,
  ...over,
});

describe("calculateBurdenedLaborCost", () => {
  it("prices hours at base plus fringes when a schedule is effective", () => {
    const result = calculateBurdenedLaborCost(
      [
        { craftClassificationId: JOURNEYMAN, date: new Date("2026-03-02"), hours: 8, payType: "STRAIGHT", perDiemAmount: null, travelPayAmount: null },
      ],
      schedules,
    );
    expect(result.wageCost).toBe(544); // 8 x (45 + 23)
    expect(result.pricedHours).toBe(8);
    expect(result.unpricedHours).toBe(0);
  });

  it("overtime multiplies the BASE wage only, never the fringes", () => {
    const result = calculateBurdenedLaborCost(
      [
        { craftClassificationId: JOURNEYMAN, date: new Date("2026-03-02"), hours: 4, payType: "OVERTIME", perDiemAmount: null, travelPayAmount: null },
      ],
      schedules,
    );
    // 4 x ((45 x 1.5) + 23) — the fringe rate is flat per hour worked.
    expect(result.wageCost).toBe(4 * (67.5 + 23));
  });

  it("reports UNPRICED HOURS rather than $0 when no schedule covers the day", () => {
    const result = calculateBurdenedLaborCost(
      [
        { craftClassificationId: JOURNEYMAN, date: new Date("2025-06-01"), hours: 8, payType: "STRAIGHT", perDiemAmount: null, travelPayAmount: null },
      ],
      schedules,
    );
    // The schedule starts 2026-01-01 and labor-cost.ts refuses to reach back
    // for the "closest" one, so these hours genuinely have no cost. The
    // defect being guarded against is them reading as a fully-costed $0.
    expect(result.wageCost).toBe(0);
    expect(result.unpricedHours).toBe(8);
    expect(result.pricedHours).toBe(0);
  });

  it("treats an untagged craft the same way — hours counted, wage refused", () => {
    const result = calculateBurdenedLaborCost(
      [
        { craftClassificationId: null, date: new Date("2026-03-02"), hours: 6, payType: "STRAIGHT", perDiemAmount: null, travelPayAmount: null },
      ],
      schedules,
    );
    expect(result.wageCost).toBe(0);
    expect(result.unpricedHours).toBe(6);
  });

  it("puts per diem and travel pay in allowanceCost and NOT in wageCost", () => {
    const result = calculateBurdenedLaborCost(
      [
        { craftClassificationId: JOURNEYMAN, date: new Date("2026-03-02"), hours: 8, payType: "STRAIGHT", perDiemAmount: 95, travelPayAmount: 40 },
      ],
      schedules,
    );
    expect(result.wageCost).toBe(544);
    expect(result.allowanceCost).toBe(135);
  });

  it("still pays an allowance on an hour it cannot price — a per diem needs no rate", () => {
    const result = calculateBurdenedLaborCost(
      [
        { craftClassificationId: null, date: new Date("2026-03-02"), hours: 8, payType: "STRAIGHT", perDiemAmount: 95, travelPayAmount: null },
      ],
      schedules,
    );
    expect(result.wageCost).toBe(0);
    expect(result.unpricedHours).toBe(8);
    expect(result.allowanceCost).toBe(95);
  });

  it("counts allowances in `total` while LABOR_ALLOWANCES_IN_JOB_COST is on", () => {
    // Pinned deliberately. The flip is a live product decision, so if
    // somebody turns it off this test names itself as the place that says
    // what the current answer is — rather than a total quietly changing
    // under three financial surfaces with nothing to point at.
    expect(LABOR_ALLOWANCES_IN_JOB_COST).toBe(true);
    const result = calculateBurdenedLaborCost(
      [
        { craftClassificationId: JOURNEYMAN, date: new Date("2026-03-02"), hours: 8, payType: "STRAIGHT", perDiemAmount: 95, travelPayAmount: 40 },
      ],
      schedules,
    );
    expect(result.total).toBe(679); // 544 wages + 135 allowances
    expect(result.total).toBe(result.wageCost + result.allowanceCost);
  });
});

describe("lineItemCostToDate", () => {
  it("ADDS labor to manual cost entries — never substitutes one for the other", () => {
    const result = lineItemCostToDate(
      "line_1",
      [{ amount: 1_200 }, { amount: 300 }],
      [entry()],
      schedules,
    );
    expect(result.actualCostToDate).toBe(1_500 + 544);
    expect(result.labor.wageCost).toBe(544);
  });

  it("takes only the time entries naming THIS line", () => {
    const result = lineItemCostToDate(
      "line_1",
      [],
      [entry(), entry({ lineItemId: "line_2" }), entry({ lineItemId: null })],
      schedules,
    );
    expect(result.actualCostToDate).toBe(544);
    expect(result.labor.pricedHours).toBe(8);
  });

  it("converts Prisma Decimal-shaped values rather than producing NaN", () => {
    // Prisma hands Decimal columns back as objects, not numbers. Three call
    // sites used to do `Number(...)` themselves; this function does it now,
    // which is what lets /jobs/[id] change one expression.
    const decimal = (v: string) => ({ toString: () => v });
    const result = lineItemCostToDate(
      "line_1",
      [{ amount: decimal("1200.00") }],
      [entry({ hours: decimal("8.00"), perDiemAmount: decimal("95.00") })],
      schedules,
    );
    expect(result.actualCostToDate).toBe(1_200 + 544 + 95);
    expect(Number.isNaN(result.actualCostToDate)).toBe(false);
  });
});

describe("unassignedLaborCost", () => {
  it("picks up the entries that name NO line item", () => {
    // The log-hours form defaults its line-item select to "No specific
    // line", so this is the ordinary shape of a logged hour, not an edge
    // case. Costing only the attached ones would leave most of a job's
    // labor out of job cost while every screen looked fixed.
    const result = unassignedLaborCost([entry(), entry({ lineItemId: null })], schedules);
    expect(result.wageCost).toBe(544);
    expect(result.pricedHours).toBe(8);
  });

  it("is zero when every hour names a line", () => {
    expect(unassignedLaborCost([entry()], schedules).total).toBe(0);
  });
});

describe("labor reaching the WIP figures (issue #287)", () => {
  const line = (over: { actualCostToDate: number; labor?: ReturnType<typeof calculateBurdenedLaborCost> }) =>
    calculateLineItemWip({
      quantity: 1,
      unitPrice: 10_000,
      budgetedUnitCost: 6_000,
      currentEstimatedUnitCost: 6_000,
      estimatedCostToComplete: null,
      ...over,
    });

  it("lands burdened labor in the line's actualCostToDate and moves percent complete", () => {
    const materialsOnly = line({ actualCostToDate: 1_500 });
    const withLabor = line(
      lineItemCostToDate("line_1", [{ amount: 1_500 }], [entry()], schedules),
    );

    expect(materialsOnly.actualCostToDate).toBe(1_500);
    expect(withLabor.actualCostToDate).toBe(2_044);
    // The defect in one assertion: the same job was 25% complete on
    // materials alone and is 34% complete once its hours count.
    expect(materialsOnly.percentComplete).toBeCloseTo(0.25, 5);
    expect(withLabor.percentComplete).toBeCloseTo(2_044 / 6_000, 5);
  });

  it("carries unpriced hours up to the job result and drops labour coverage", () => {
    const priced = lineItemCostToDate("line_1", [], [entry()], schedules);
    const unpriced = lineItemCostToDate(
      "line_1",
      [],
      [entry({ craftClassificationId: null, hours: 24 })],
      schedules,
    );
    const job = calculateJobWip([line(priced), line(unpriced)], 0);

    expect(job.unpricedLaborHours).toBe(24);
    expect(job.pricedLaborHours).toBe(8);
    expect(job.laborHourCoverage).toBeCloseTo(8 / 32, 5);
    // And the money those 24 hours contributed is zero, which is exactly
    // why the hours have to be on screen.
    expect(job.laborWageCost).toBe(544);
  });

  it("reports full labour coverage when no hours are logged at all", () => {
    const job = calculateJobWip([line({ actualCostToDate: 1_500 })], 0);
    expect(job.laborHourCoverage).toBe(1);
    expect(job.unpricedLaborHours).toBe(0);
    expect(job.laborCostToDate).toBe(0);
  });

  it("puts unattached labor in job cost and lets costCoverage say it is off-forecast", () => {
    const forecast = line(lineItemCostToDate("line_1", [{ amount: 1_500 }], [], schedules));
    const job = calculateJobWip(
      [forecast],
      0,
      unassignedLaborCost([entry({ lineItemId: null })], schedules),
    );

    expect(job.actualCostToDate).toBe(1_500 + 544);
    expect(job.unassignedLaborCost).toBe(544);
    // costCoverage is cost-on-forecast-LINES over all cost. The unattached
    // labor is in the denominator and not the numerator, so the existing
    // caveat on /jobs/[id] already reports it without a new mechanism.
    expect(job.costCoverage).toBeCloseTo(1_500 / 2_044, 5);
    expect(job.laborWageCost).toBe(544);
  });

  it("splits wages from allowances all the way up to the job result", () => {
    const withPerDiem = lineItemCostToDate(
      "line_1",
      [],
      [entry({ perDiemAmount: 95 })],
      schedules,
    );
    const job = calculateJobWip([line(withPerDiem)], 0);
    expect(job.laborWageCost).toBe(544);
    expect(job.laborAllowanceCost).toBe(95);
    expect(job.laborCostToDate).toBe(639);
    expect(job.actualCostToDate).toBe(639);
  });

  it("defaults to the old behaviour for a caller that has not fetched hours", () => {
    // calculateJobWip's third argument is optional on purpose: a caller
    // that never loaded time entries must get the pre-#287 number, not a
    // silently wrong one built out of an empty list it never asked for.
    const job = calculateJobWip([line({ actualCostToDate: 1_500 })], 0);
    expect(job.actualCostToDate).toBe(1_500);
    expect(job.unassignedLaborCost).toBe(0);
  });
});
