import { describe, expect, it } from "vitest";
import {
  HEALTHY_MARGIN_RATE,
  calculateCompanyFinancials,
  jobCostVariance,
  jobHealthSentence,
  jobIsOverBudget,
  marginIsHealthy,
} from "./company-financials";
import type { WipJobResult } from "./wip";

const job = (over: Partial<WipJobResult> = {}): WipJobResult => ({
  contractValue: 100_000,
  actualCostToDate: 30_000,
  estimatedCostAtCompletion: 60_000,
  percentComplete: 0.5,
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
      retainageBalances: [],
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
      retainageBalances: [],
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
      retainageBalances: [],
    });
    expect(result.grossMarginRate).toBeNull();
  });

  it("reports a negative margin rather than hiding it", () => {
    const result = calculateCompanyFinancials({
      jobs: [job({ earnedRevenue: 100_000, actualCostToDate: 130_000 })],
      cashCollected: 0,
      totalBilled: 0,
      retainageBalances: [],
    });
    expect(result.grossMarginRate).toBeCloseTo(-0.3, 5);
  });

  it("separates cash collected from what is still owed", () => {
    const result = calculateCompanyFinancials({
      jobs: [job()],
      cashCollected: 40_000,
      totalBilled: 65_000,
      retainageBalances: [],
    });
    expect(result.cashPosition).toBe(40_000);
    expect(result.outstandingReceivable).toBe(25_000);
  });

  it("sums retainage held across jobs", () => {
    const result = calculateCompanyFinancials({
      jobs: [job()],
      cashCollected: 0,
      totalBilled: 0,
      retainageBalances: [5_000, 2_500, 0],
    });
    expect(result.retainageHeld).toBe(7_500);
  });

  it("has nothing to say about no jobs, without dividing by zero", () => {
    const result = calculateCompanyFinancials({
      jobs: [],
      cashCollected: 0,
      totalBilled: 0,
      retainageBalances: [],
    });
    expect(result).toMatchObject({ estimatedRevenue: 0, grossMarginRate: null, retainageHeld: 0 });
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
  const sentenceFor = (over: Partial<WipJobResult>) =>
    jobHealthSentence({ name: "Riverside", wip: job(over) });

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

  it("includes progress when it is known and omits it when it is not", () => {
    expect(sentenceFor({ percentComplete: 0.42 }).sentence).toContain("42% complete");
    expect(sentenceFor({ percentComplete: null }).sentence).not.toContain("complete.");
  });
});
