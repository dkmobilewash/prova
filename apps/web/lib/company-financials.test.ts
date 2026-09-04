import { describe, expect, it } from "vitest";
import {
  HEALTHY_MARGIN_RATE,
  MIN_EARNED_COVERAGE,
  MIN_ESTIMATE_COVERAGE,
  calculateCompanyFinancials,
  jobCostVariance,
  jobEarnedRevenue,
  jobHealthSentence,
  jobIsOverBudget,
  jobOverUnderBilling,
  marginIsHealthy,
} from "./company-financials";
import type { WipJobResult } from "./wip";
import { daysPastDueFor, effectiveDueDateFor, isOverdue } from "./cash-flow";

const job = (over: Partial<WipJobResult> = {}): WipJobResult => ({
  contractValue: 100_000,
  actualCostToDate: 30_000,
  estimatedCostAtCompletion: 60_000,
  percentComplete: 0.5,
  costCoverage: 1,
  earnedCoverage: 1,
  estimatedCoverage: 1,
  earnedRevenue: 50_000,
  billedToDate: 50_000,
  overUnderBilling: 0,
  ...over,
});

describe("calculateCompanyFinancials", () => {
  it("sums contract value across active jobs — the backlog figure", () => {
    const result = calculateCompanyFinancials({
      jobs: [job({ contractValue: 100_000 }), job({ contractValue: 250_000 })],
      cashCollected: 0,
      totalBilled: 0,
      retainageHeld: 0,
    });
    expect(result.estimatedRevenue).toBe(350_000);
  });

  it("blends margin by summing both sides, not by averaging job margins", () => {
    // A $2M job and a $20k job are not equal evidence of how the business
    // is doing. Averaging their margins would say they are.
    const big = job({ earnedRevenue: 1_000_000, actualCostToDate: 800_000 }); // 20%
    const small = job({ earnedRevenue: 10_000, actualCostToDate: 1_000 }); // 90%
    const result = calculateCompanyFinancials({
      jobs: [big, small],
      cashCollected: 0,
      totalBilled: 0,
      retainageHeld: 0,
    });
    // Blended: 209,000 / 1,010,000 ≈ 20.7%. A naive average would say 55%.
    expect(result.grossMarginRate).toBeCloseTo(0.2069, 3);
    expect(result.grossProfit).toBe(209_000);
  });

  it("has no margin when nothing has been earned, rather than reporting zero", () => {
    // A margin on zero revenue is a division, not a fact.
    const result = calculateCompanyFinancials({
      jobs: [job({ earnedRevenue: 0, actualCostToDate: 0 })],
      cashCollected: 0,
      totalBilled: 0,
      retainageHeld: 0,
    });
    expect(result.grossMarginRate).toBeNull();
  });

  it("reports a negative margin rather than hiding it", () => {
    const result = calculateCompanyFinancials({
      jobs: [job({ earnedRevenue: 100_000, actualCostToDate: 130_000 })],
      cashCollected: 0,
      totalBilled: 0,
      retainageHeld: 0,
    });
    expect(result.grossMarginRate).toBeCloseTo(-0.3, 5);
  });

  it("separates cash collected from what is still owed", () => {
    const result = calculateCompanyFinancials({
      jobs: [job()],
      cashCollected: 40_000,
      totalBilled: 65_000,
      retainageHeld: 0,
    });
    expect(result.cashPosition).toBe(40_000);
    expect(result.outstandingReceivable).toBe(25_000);
  });

  // The case that used to sit here summed `retainageBalances: [5_000,
  // 2_500, 0]` to 7_500. Since #97 the input is the figure itself, so that
  // assertion became `7_500 -> 7_500` and was deleted rather than kept as
  // decoration. The figure is now proven where it can actually be wrong —
  // in the query, in retainage-query.dbtest.ts.

  it("has nothing to say about no jobs, without dividing by zero", () => {
    const result = calculateCompanyFinancials({
      jobs: [],
      cashCollected: 0,
      totalBilled: 0,
      retainageHeld: 0,
    });
    expect(result).toMatchObject({ estimatedRevenue: 0, grossMarginRate: null, retainageHeld: 0 });
  });
});

describe("a billing position nobody can stand behind (#99)", () => {
  it("refuses to state one on a half-estimated job", () => {
    expect(jobOverUnderBilling(job({ overUnderBilling: 80_000, earnedCoverage: 0.5 }))).toBeNull();
    expect(jobEarnedRevenue(job({ earnedRevenue: 50_000, earnedCoverage: 0.5 }))).toBeNull();
    expect(jobOverUnderBilling(job({ overUnderBilling: 80_000, earnedCoverage: 1 }))).toBe(80_000);
    expect(jobEarnedRevenue(job({ earnedRevenue: 50_000, earnedCoverage: 1 }))).toBe(50_000);
  });

  it("draws the line exactly at the coverage threshold", () => {
    expect(jobOverUnderBilling(job({ earnedCoverage: MIN_EARNED_COVERAGE }))).not.toBeNull();
    expect(jobOverUnderBilling(job({ earnedCoverage: MIN_EARNED_COVERAGE - 0.001 }))).toBeNull();
  });

  it("keeps the guard separate from the cost-side one, at the same number", () => {
    // Same threshold, different question. Collapsing them into one constant
    // invites reusing one ratio for both predicates, which is the hole: a
    // line estimated at zero cost is covered on the cost side and not on the
    // revenue side.
    expect(MIN_EARNED_COVERAGE).toBe(MIN_ESTIMATE_COVERAGE);
    expect(jobOverUnderBilling(job({ earnedCoverage: 0.5, estimatedCoverage: 1 }))).toBeNull();
  });
});

describe("the company margin when the book is not substantially estimated (#99)", () => {
  it("says nothing rather than blending a margin over jobs that earned nothing", () => {
    const solid = job({ contractValue: 100_000, earnedRevenue: 100_000, actualCostToDate: 60_000 });
    const half = job({
      contractValue: 100_000,
      earnedRevenue: 50_000,
      actualCostToDate: 90_000,
      earnedCoverage: 0.5,
    });
    const result = calculateCompanyFinancials({
      jobs: [solid, half],
      cashCollected: 0,
      totalBilled: 0,
      retainageBalances: [],
    });
    // 75% of the book carries an earned-revenue figure. Below the threshold,
    // so the bar says "—" instead of a number.
    expect(result.grossMarginRate).toBeNull();
    expect(result.earnedCoverage).toBeCloseTo(0.75, 10);
    // And the $90,000 of real spend is STILL in gross profit. Dropping the
    // under-covered job out of both sums would report 40% margin here and
    // colour it green, which is the opposite failure direction from the bug:
    // an overstated overbilling makes a sub bill cautiously, a flattered
    // margin makes them keep going.
    expect(result.grossProfit).toBe(0);
    expect(result.estimatedRevenue).toBe(200_000);
  });

  it("is not silenced by one small unbudgeted job in a large book", () => {
    // Value-weighted, so a $20k job nobody has estimated does not blank the
    // bar for a $2M book. It goes quiet only when a material share of the
    // company's contract value is unestimated.
    const big = job({ contractValue: 2_000_000, earnedRevenue: 1_000_000, actualCostToDate: 600_000 });
    const scrap = job({ contractValue: 20_000, earnedRevenue: 0, actualCostToDate: 0, earnedCoverage: 0 });
    const result = calculateCompanyFinancials({
      jobs: [big, scrap],
      cashCollected: 0,
      totalBilled: 0,
      retainageBalances: [],
    });
    expect(result.grossMarginRate).toBeCloseTo(0.4, 10);
  });
});

describe("jobIsOverBudget — forecast, not spend-to-date", () => {
  it("flags a job forecast to finish above contract value", () => {
    expect(jobIsOverBudget(job({ contractValue: 100_000, estimatedCostAtCompletion: 110_000 }))).toBe(true);
  });

  it("does not flag a job that has merely spent a lot so far", () => {
    // 90% of the money spent at 90% complete is a job going to plan. The
    // question is where it LANDS, not where it is.
    expect(
      jobIsOverBudget(
        job({ contractValue: 100_000, actualCostToDate: 54_000, estimatedCostAtCompletion: 60_000 }),
      ),
    ).toBe(false);
  });

  it("says it does not know when there is no cost estimate", () => {
    // Reporting "we don't know" as "on budget" is how a figure loses its
    // meaning.
    expect(jobIsOverBudget(job({ estimatedCostAtCompletion: 0 }))).toBeNull();
    expect(jobIsOverBudget(job({ contractValue: 0 }))).toBeNull();
  });
});

describe("jobCostVariance", () => {
  it("is positive over and negative under, as a share of contract value", () => {
    expect(jobCostVariance(job({ contractValue: 100_000, estimatedCostAtCompletion: 120_000 }))).toBeCloseTo(0.2);
    expect(jobCostVariance(job({ contractValue: 100_000, estimatedCostAtCompletion: 60_000 }))).toBeCloseTo(-0.4);
  });
});

describe("marginIsHealthy — a number that is always green stops being read", () => {
  it("is not healthy at the mockup's sample 24.6%", () => {
    expect(marginIsHealthy(0.246)).toBe(false);
  });

  it("needs to clear the threshold, not merely reach it", () => {
    expect(marginIsHealthy(HEALTHY_MARGIN_RATE)).toBe(false);
    expect(marginIsHealthy(HEALTHY_MARGIN_RATE + 0.001)).toBe(true);
  });

  it("is not healthy when there is no margin to judge", () => {
    expect(marginIsHealthy(null)).toBe(false);
  });
});

describe("jobHealthSentence", () => {
  const sentenceFor = (over: Partial<WipJobResult>, estimatedCoverage = 1) =>
    jobHealthSentence({ name: "Riverside", wip: job(over), estimatedCoverage });

  it("says how far over, in words", () => {
    const result = sentenceFor({ contractValue: 100_000, estimatedCostAtCompletion: 120_000 });
    expect(result.tone).toBe("over");
    expect(result.sentence).toContain("20% over");
  });

  it("distinguishes just-over from meaningfully-over", () => {
    // A job 1% over does not deserve the same red as one 20% over.
    expect(sentenceFor({ contractValue: 100_000, estimatedCostAtCompletion: 101_000 }).tone).toBe("watch");
  });

  it("says under when it is under", () => {
    const result = sentenceFor({ contractValue: 100_000, estimatedCostAtCompletion: 60_000 });
    expect(result.tone).toBe("fine");
    expect(result.sentence).toContain("40% under");
  });

  it("admits when there is nothing to compare", () => {
    const result = sentenceFor({ estimatedCostAtCompletion: 0 });
    expect(result.tone).toBe("unknown");
    expect(result.sentence).toContain("nothing to compare");
  });

  it("refuses to forecast a job that is barely estimated", () => {
    // The real case: one budgeted line out of seven read "97% under
    // contract value", because the six unbudgeted lines contributed zero
    // forecast cost while their contract value still counted. A number
    // that flatters you for not having estimated is worse than none.
    const result = sentenceFor({ contractValue: 30_625, estimatedCostAtCompletion: 900 }, 0.057);
    expect(result.tone).toBe("unknown");
    expect(result.sentence).toContain("6% of this job");
    expect(result.sentence).not.toContain("under contract value");
  });

  it("does forecast once most of the value is estimated", () => {
    expect(sentenceFor({ contractValue: 100_000, estimatedCostAtCompletion: 120_000 }, 0.85).tone).toBe(
      "over",
    );
  });

  it("draws the line exactly at the coverage threshold", () => {
    expect(sentenceFor({}, MIN_ESTIMATE_COVERAGE).tone).not.toBe("unknown");
    expect(sentenceFor({}, MIN_ESTIMATE_COVERAGE - 0.001).tone).toBe("unknown");
  });

  it("includes progress when it is known and omits it when it is not", () => {
    expect(sentenceFor({ percentComplete: 0.42 }).sentence).toContain("42% complete");
    expect(sentenceFor({ percentComplete: null }).sentence).not.toContain("complete.");
  });
});

describe("one overdue rule, shared", () => {
  // These two pages have now disagreed about which invoices are overdue
  // twice: once because the dashboard read only the stored due date, and
  // again because a hand-copied version of the rule missed that a GC with
  // no stated terms is treated as due on issue. Both call the same
  // functions now; these assert the behaviour that kept slipping.
  const issued = new Date("2026-08-28T00:00:00.000Z");

  it("treats a GC with no payment terms as due on issue, not as undated", () => {
    expect(
      effectiveDueDateFor({ dueAt: null, issuedAt: issued, paymentTermsDays: null }),
    ).toEqual(issued);
  });

  it("uses the GC's terms when there is no stated due date", () => {
    expect(
      effectiveDueDateFor({ dueAt: null, issuedAt: issued, paymentTermsDays: 30 }),
    ).toEqual(new Date("2026-09-27T00:00:00.000Z"));
  });

  it("prefers an explicit due date over the terms", () => {
    const stated = new Date("2026-09-01T00:00:00.000Z");
    expect(
      effectiveDueDateFor({ dueAt: stated, issuedAt: issued, paymentTermsDays: 30 }),
    ).toEqual(stated);
  });

  it("an invoice due TODAY is not overdue, at any hour", () => {
    // The second contradiction: the forecast compared instants and called
    // a midnight-dated invoice overdue by lunchtime, while the aging table
    // floored to whole days and still called it current.
    const due = new Date("2026-08-30T00:00:00.000Z");
    expect(isOverdue(due, new Date("2026-08-30T00:00:01.000Z"))).toBe(false);
    expect(isOverdue(due, new Date("2026-08-30T23:59:59.000Z"))).toBe(false);
  });

  it("is overdue from the next day", () => {
    const due = new Date("2026-08-30T00:00:00.000Z");
    expect(isOverdue(due, new Date("2026-08-31T00:00:00.000Z"))).toBe(true);
    expect(daysPastDueFor(due, new Date("2026-09-01T00:00:00.000Z"))).toBe(2);
  });
});
