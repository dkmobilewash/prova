import { describe, expect, it } from "vitest";

import {
  MINIMUM_SAMPLE,
  benchmarkFromHistory,
  conceptualRange,
  conceptualSentence,
  type HistoricalJob,
} from "./conceptual-estimate";

const job = (over: Partial<HistoricalJob> & Pick<HistoricalJob, "jobId">): HistoricalJob => ({
  jobName: "A job",
  grossAreaSqFt: 1_000,
  contractValue: 50_000,
  actualCostToDate: 40_000,
  settled: true,
  ...over,
});

const money = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

describe("a rate needs enough finished jobs to be a rate at all", () => {
  it("REFUSES A RANGE below the floor, and says why", () => {
    // THE DEFECT THIS EXISTS FOR. One job's numbers presented as a $/SF rate
    // is that job wearing a disguise — and a $/SF figure looks exactly like a
    // measured one.
    const result = benchmarkFromHistory([job({ jobId: "a" }), job({ jobId: "b" })]);
    expect(result.sellPerSqFt).toBeNull();
    expect(result.costPerSqFt).toBeNull();
    expect(result.sampleSize).toBe(2);
    expect(result.because).toContain("one job wearing a disguise");
  });

  it("the floor is three, and it is exported so the screen cannot disagree", () => {
    expect(MINIMUM_SAMPLE).toBe(3);
    const three = [job({ jobId: "a" }), job({ jobId: "b" }), job({ jobId: "c" })];
    expect(benchmarkFromHistory(three).sellPerSqFt).not.toBeNull();
  });

  it("always reports the sample size, including when there is no range", () => {
    expect(benchmarkFromHistory([]).sampleSize).toBe(0);
    expect(benchmarkFromHistory([job({ jobId: "a" })]).sampleSize).toBe(1);
  });

  it("distinguishes 'no areas recorded' from 'no finished jobs'", () => {
    const noAreas = benchmarkFromHistory([
      job({ jobId: "a", grossAreaSqFt: null }),
      job({ jobId: "b", grossAreaSqFt: null }),
    ]);
    expect(noAreas.because).toContain("2 jobs are finished");
    expect(noAreas.because).toContain("no area");

    const nothing = benchmarkFromHistory([]);
    expect(nothing.because).toContain("No finished job has a gross area");
    expect(nothing.because).not.toContain("jobs are finished but");
  });
});

describe("only settled jobs with a real area contribute", () => {
  it("IGNORES an unfinished job — it has spent cost and earned no lessons", () => {
    const result = benchmarkFromHistory([
      job({ jobId: "a" }),
      job({ jobId: "b" }),
      job({ jobId: "c" }),
      job({ jobId: "running", settled: false, contractValue: 10_000_000 }),
    ]);
    expect(result.sampleSize).toBe(3);
    // The huge unfinished job would have blown the high end wide open.
    expect(result.sellPerSqFt?.high).toBe(50);
  });

  it("ignores a zero or negative area rather than dividing by it", () => {
    const result = benchmarkFromHistory([
      job({ jobId: "a" }),
      job({ jobId: "b" }),
      job({ jobId: "c" }),
      job({ jobId: "zero", grossAreaSqFt: 0 }),
      job({ jobId: "negative", grossAreaSqFt: -100 }),
    ]);
    expect(result.sampleSize).toBe(3);
    expect(Number.isFinite(result.sellPerSqFt?.high ?? 0)).toBe(true);
  });

  it("filters again rather than trusting the query to have done it", () => {
    // A benchmark gets quoted long after anybody remembers where it came
    // from, so the rule lives with the arithmetic.
    const result = benchmarkFromHistory([
      job({ jobId: "a", settled: false }),
      job({ jobId: "b", settled: false }),
      job({ jobId: "c", settled: false }),
    ]);
    expect(result.sampleSize).toBe(0);
    expect(result.sellPerSqFt).toBeNull();
  });
});

describe("the numbers themselves", () => {
  const spread = [
    job({ jobId: "a", grossAreaSqFt: 1_000, contractValue: 40_000, actualCostToDate: 30_000 }),
    job({ jobId: "b", grossAreaSqFt: 2_000, contractValue: 100_000, actualCostToDate: 88_000 }),
    job({ jobId: "c", grossAreaSqFt: 1_000, contractValue: 60_000, actualCostToDate: 50_000 }),
  ];

  it("is a range with a middle, not a single figure", () => {
    const result = benchmarkFromHistory(spread);
    // 40, 50, 60 $/SF sold.
    expect(result.sellPerSqFt).toEqual({ low: 40, median: 50, high: 60 });
    // 30, 44, 50 $/SF cost.
    expect(result.costPerSqFt).toEqual({ low: 30, median: 44, high: 50 });
  });

  it("reports sell AND cost, because the gap between them is the margin", () => {
    const result = benchmarkFromHistory(spread);
    expect(result.sellPerSqFt!.median).toBeGreaterThan(result.costPerSqFt!.median);
  });

  it("averages the two middles on an even sample", () => {
    const result = benchmarkFromHistory([
      ...spread,
      job({ jobId: "d", grossAreaSqFt: 1_000, contractValue: 80_000, actualCostToDate: 70_000 }),
    ]);
    // The four sell rates are 40, 50, 60 and 80 $/SF (job b is 2,000 SF for
    // $100,000). Sorted, the two middles are 50 and 60, so the median is 55 —
    // a value NO job actually has, which is the point of averaging them.
    expect(result.sellPerSqFt!.median).toBe(55);
  });
});

describe("turning an area into a range", () => {
  const benchmark = benchmarkFromHistory([
    job({ jobId: "a", grossAreaSqFt: 1_000, contractValue: 40_000, actualCostToDate: 30_000 }),
    job({ jobId: "b", grossAreaSqFt: 1_000, contractValue: 50_000, actualCostToDate: 40_000 }),
    job({ jobId: "c", grossAreaSqFt: 1_000, contractValue: 60_000, actualCostToDate: 50_000 }),
  ]);

  it("scales the whole range, never a single number", () => {
    const result = conceptualRange(2_000, benchmark);
    expect(result.sell).toEqual({ low: 80_000, median: 100_000, high: 120_000 });
    expect(result.cost).toEqual({ low: 60_000, median: 80_000, high: 100_000 });
    expect(result.sampleSize).toBe(3);
  });

  it("is NULL rather than zero when there is no benchmark", () => {
    // By construction, so a screen cannot print a figure that does not exist
    // by forgetting to check — the posture bid-outcome.ts takes.
    const thin = benchmarkFromHistory([job({ jobId: "a" })]);
    const result = conceptualRange(2_000, thin);
    expect(result.sell).toBeNull();
    expect(result.cost).toBeNull();
    expect(result.because).toContain("Only 1 finished job");
  });

  it("asks for an area rather than computing from nothing", () => {
    expect(conceptualRange(0, benchmark).because).toContain("Enter the building's gross area");
    expect(conceptualRange(0, benchmark).sell).toBeNull();
    expect(conceptualRange(Number.NaN, benchmark).sell).toBeNull();
  });
});

describe("the sentence never states a single number and always says the sample", () => {
  const benchmark = benchmarkFromHistory([
    job({ jobId: "a", grossAreaSqFt: 1_000, contractValue: 40_000, actualCostToDate: 30_000 }),
    job({ jobId: "b", grossAreaSqFt: 1_000, contractValue: 50_000, actualCostToDate: 40_000 }),
    job({ jobId: "c", grossAreaSqFt: 1_000, contractValue: 60_000, actualCostToDate: 50_000 }),
  ]);

  it("names the range, the middle and the number of jobs behind it", () => {
    const sentence = conceptualSentence(conceptualRange(2_000, benchmark), money);
    expect(sentence).toContain("From 3 finished jobs");
    expect(sentence).toContain("$80,000 to $120,000");
    expect(sentence).toContain("middle $100,000");
  });

  it("SAYS IT IS NOT AN ESTIMATE AND NOT A PRICE", () => {
    // The hedge is the feature. A $/SF figure looks exactly like a measured
    // one, and this is the only thing standing between it and a GC's inbox.
    const sentence = conceptualSentence(conceptualRange(2_000, benchmark), money);
    expect(sentence).toContain("order-of-magnitude");
    expect(sentence).toContain("not an estimate");
    expect(sentence).toContain("not a price to send anybody");
  });

  it("falls back to the reason when there is nothing to say", () => {
    const thin = benchmarkFromHistory([]);
    expect(conceptualSentence(conceptualRange(2_000, thin), money)).toContain("No finished job");
  });
});
