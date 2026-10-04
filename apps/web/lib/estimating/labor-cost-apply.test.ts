import { describe as group, expect, it } from "vitest";
import { laborCostApplyDecision, type LaborCostLine } from "./labor-cost-apply";

/**
 * Every way "Use this as the cost" can refuse, and the one way it agrees.
 *
 * THE REFUSALS ARE THE FEATURE, not the error handling. This button writes a
 * figure into the column the bid recap marks up, so each "no" has to say what
 * the estimator can do about it — a dead button on a money screen is the
 * failure the whole `ActionResult` convention exists to prevent, and a refusal
 * that only says "cannot" is a dead button with punctuation.
 */

const schedule = (from: string, to: string | null, baseWage: number) => ({
  baseWage,
  pensionRate: 5,
  vacationRate: 3,
  healthWelfareRate: 10,
  trainingRate: 2, // fringe total: $20/hr
  effectiveFrom: new Date(from),
  effectiveTo: to ? new Date(to) : null,
});

const schedules = [schedule("2026-01-01", null, 50)];
const march = new Date("2026-03-01");

const line = (over: Partial<LaborCostLine> = {}): LaborCostLine => ({
  quantity: 100,
  laborHours: 80,
  productionRate: null,
  budgetedUnitCost: null,
  costCategory: "LABOR",
  ...over,
});

group("it prices a labor line", () => {
  it("divides the line's labor cost by its quantity", () => {
    // 80 hrs x ($50 base + $20 fringe) = $5,600 over 100 units = $56.00/unit.
    const decision = laborCostApplyDecision(line(), schedules, march, null);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.lineTotal).toBe(5600);
    expect(decision.unitCost).toBe(56);
    expect(decision.hours).toBe(80);
  });

  it("carries the employer burden through to the unit cost", () => {
    // 15% of the $4,000 base = $600, so $6,200 over 100 units = $62.00.
    const decision = laborCostApplyDecision(line(), schedules, march, 15);
    expect(decision.ok && decision.unitCost).toBe(62);
  });

  it("derives hours from a production rate when no hours are typed", () => {
    // 100 units at 2.5 units/hr = 40 hrs x $70 = $2,800 over 100 = $28.00.
    const decision = laborCostApplyDecision(
      line({ laborHours: null, productionRate: 2.5 }),
      schedules,
      march,
      null,
    );
    expect(decision.ok && decision.hours).toBe(40);
    expect(decision.ok && decision.unitCost).toBe(28);
  });

  it("rounds to the cent, because the column is money", () => {
    // 80 hrs x $70 = $5,600 over 3 units = $1,866.666… → $1,866.67.
    const decision = laborCostApplyDecision(line({ quantity: 3 }), schedules, march, null);
    expect(decision.ok && decision.unitCost).toBe(1866.67);
  });

  it("offers to REPLACE a cost that is merely different, not only a missing one", () => {
    // The estimator may have typed a figure and then changed the hours. The
    // button is how they accept the new one; refusing would strand them with a
    // stale cost and no way to take the derived figure.
    const decision = laborCostApplyDecision(line({ budgetedUnitCost: 12 }), schedules, march, null);
    expect(decision.ok && decision.unitCost).toBe(56);
  });
});

group("it refuses, and says what to do about it", () => {
  const refusalOf = (over: Partial<LaborCostLine>, percent: number | null = null) => {
    const decision = laborCostApplyDecision(line(over), schedules, march, percent);
    expect(decision.ok, "expected a refusal").toBe(false);
    return decision.ok ? "" : decision.error;
  };

  it("REFUSES A NON-LABOR LINE, because writing there would replace the material cost", () => {
    // The one that matters most. A line carries one costCategory and one
    // budgetedUnitCost; on a combined "hang and finish" line coded MATERIAL,
    // writing labor would not add to the board cost, it would delete it.
    const error = refusalOf({ costCategory: "MATERIAL" });
    expect(error).toContain("coded material");
    expect(error).toContain("replace");
    expect(error).toContain("LABOR");
  });

  it("refuses an uncoded line in words that fit a blank", () => {
    // "coded null" would be the obvious bug in the sentence above.
    const error = refusalOf({ costCategory: null });
    expect(error).toContain("not coded to a cost type");
    expect(error).not.toContain("null");
  });

  it("refuses when there are no hours, naming both ways to give it some", () => {
    const error = refusalOf({ laborHours: null, productionRate: null });
    expect(error).toContain("no labor hours");
    expect(error).toContain("production rate");
  });

  it("refuses when no fringe schedule covers the date, rather than guessing one", () => {
    // Inherited from estimateBurdenedLaborCost, which never picks the closest
    // schedule "because a wrong one gets bid".
    const decision = laborCostApplyDecision(line(), schedules, new Date("2025-01-01"), null);
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.error).toContain("No fringe rate schedule is effective");
  });

  it("refuses a zero quantity AFTER checking the hours and the rate", () => {
    // Order matters: told about the thing they can act on, not the first thing
    // that happens to fail. A line with no quantity AND no hours should hear
    // about the hours.
    expect(refusalOf({ quantity: 0 })).toContain("no quantity");
    expect(refusalOf({ quantity: 0, laborHours: null, productionRate: null })).toContain("no labor hours");
  });

  it("refuses when the cost would round away to nothing", () => {
    // A tiny labor cost spread over a huge quantity. Writing 0.00 would look
    // like a priced line and carry nothing into the bid — the exact silent
    // zero this whole change exists to end.
    const error = refusalOf({ quantity: 10_000_000, laborHours: 0.001 });
    expect(error).toContain("round to nothing");
  });

  it("refuses when the budgeted cost already matches", () => {
    const error = refusalOf({ budgetedUnitCost: 56 });
    expect(error).toContain("already matches");
  });

  it("treats a cost that matches only after rounding as already matching", () => {
    // $56.004 and $56.00 are the same number once written to Decimal(12,2), so
    // offering to "change" it would write the identical row and report success
    // on a no-op.
    expect(refusalOf({ budgetedUnitCost: 56.004 })).toContain("already matches");
  });

  it("every refusal is a sentence, not a code", () => {
    // A refusal a person cannot act on is a dead button with punctuation.
    for (const over of [
      { costCategory: "MATERIAL" },
      { costCategory: null },
      { laborHours: null, productionRate: null },
      { quantity: 0 },
      { budgetedUnitCost: 56 },
    ] satisfies Partial<LaborCostLine>[]) {
      const error = refusalOf(over);
      expect(error.length, error).toBeGreaterThan(40);
      expect(error.trim().endsWith("."), error).toBe(true);
    }
  });
});
