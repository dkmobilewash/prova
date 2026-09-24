import { describe, expect, it } from "vitest";

import { bidOutcome, bidRecord, settledSentence, type BidOutcomeInput } from "./bid-outcome";

const money = (value: number) => `$${value.toFixed(2)}`;

/** A job bid at 100,000, contracted at the same, complete, and costed. */
const SETTLED: BidOutcomeInput = {
  bidAmount: 100_000,
  jobStatus: "COMPLETE",
  contractValue: 100_000,
  actualCostToDate: 92_000,
  percentComplete: 1,
};

describe("a verdict is only given on a finished job", () => {
  it("settles a complete job and states the variance", () => {
    const outcome = bidOutcome(SETTLED);
    expect(outcome.state).toBe("SETTLED");
    expect(outcome.because).toBeNull();
    expect(outcome.costVsBid).toBe(-8000);
    expect(outcome.costVsBidPercent).toBeCloseTo(-0.08, 6);
  });

  it("REFUSES a verdict on a running job, however far along", () => {
    for (const status of ["ESTIMATE", "CONTRACTED", "IN_PROGRESS"]) {
      const outcome = bidOutcome({ ...SETTLED, jobStatus: status, percentComplete: 0.97 });
      expect(outcome.state, status).toBe("PENDING");
      // The numbers that would be mistaken for a verdict are NOT PRESENT —
      // not merely un-rendered. A caller cannot print what does not exist.
      expect(outcome.costVsBid, status).toBeNull();
      expect(outcome.costVsBidPercent, status).toBeNull();
      expect(outcome.because, status).toMatch(/still running/);
    }
  });

  it("still reports cost to date while pending, labelled as such", () => {
    const outcome = bidOutcome({ ...SETTLED, jobStatus: "IN_PROGRESS", actualCostToDate: 20_000, percentComplete: 0.2 });
    expect(outcome.actualCostToDate).toBe(20_000);
    expect(outcome.because).toContain("20% complete");
    expect(outcome.because).not.toMatch(/margin/i);
  });

  it("says so when a running job has no forecast to place it against", () => {
    const outcome = bidOutcome({ ...SETTLED, jobStatus: "IN_PROGRESS", percentComplete: null });
    expect(outcome.state).toBe("PENDING");
    expect(outcome.because).toMatch(/cannot be worked out yet/);
  });

  it("does not treat 100% complete as finished — the status is the statement", () => {
    // A job can read 100% by cost forecast while work continues, and the
    // forecast is an inference where the status is a person's word.
    const outcome = bidOutcome({ ...SETTLED, jobStatus: "IN_PROGRESS", percentComplete: 1 });
    expect(outcome.state).toBe("PENDING");
  });
});

describe("what cannot be compared is named, not guessed", () => {
  it("refuses a bid with no amount recorded", () => {
    const outcome = bidOutcome({ ...SETTLED, bidAmount: null });
    expect(outcome.state).toBe("UNKNOWABLE");
    expect(outcome.because).toMatch(/no amount recorded/);
    expect(outcome.contractVsBid).toBeNull();
  });

  it("refuses a zero bid rather than dividing by it", () => {
    const outcome = bidOutcome({ ...SETTLED, bidAmount: 0 });
    expect(outcome.state).toBe("UNKNOWABLE");
    expect(outcome.costVsBidPercent).toBeNull();
  });

  it("refuses a complete job with no costs against it", () => {
    const outcome = bidOutcome({ ...SETTLED, actualCostToDate: 0 });
    expect(outcome.state).toBe("UNKNOWABLE");
    expect(outcome.because).toMatch(/no costs recorded/);
  });
});

describe("contract against bid is reported separately from cost", () => {
  it("shows what the job was sold for against what it was bid", () => {
    // Change orders live here. Folding this into one "variance" would hide
    // a job that was bid low, grew by change order, and still made money.
    const outcome = bidOutcome({ ...SETTLED, contractValue: 118_000 });
    expect(outcome.contractVsBid).toBe(18_000);
    expect(outcome.costVsBid).toBe(-8000);
  });

  it("reports contract-vs-bid even while the job is pending", () => {
    const outcome = bidOutcome({ ...SETTLED, jobStatus: "IN_PROGRESS", contractValue: 118_000 });
    expect(outcome.state).toBe("PENDING");
    expect(outcome.contractVsBid).toBe(18_000);
  });
});

describe("the sentence beside a settled bid", () => {
  it("names the direction and the size", () => {
    expect(settledSentence(bidOutcome(SETTLED), money)).toBe(
      "Cost $8000.00 less than it was bid at — 8% under.",
    );
    const over = bidOutcome({ ...SETTLED, actualCostToDate: 115_000 });
    expect(settledSentence(over, money)).toBe("Cost $15000.00 more than it was bid at — 15% over.");
  });

  it("gives a decimal place to a small variance rather than rounding it to nothing", () => {
    const small = bidOutcome({ ...SETTLED, actualCostToDate: 101_200 });
    expect(settledSentence(small, money)).toContain("1.2% over");
  });

  it("returns NOTHING for anything unsettled, so a verdict cannot leak", () => {
    expect(settledSentence(bidOutcome({ ...SETTLED, jobStatus: "IN_PROGRESS" }), money)).toBeNull();
    expect(settledSentence(bidOutcome({ ...SETTLED, bidAmount: null }), money)).toBeNull();
  });

  it("says so when it landed exactly", () => {
    expect(settledSentence(bidOutcome({ ...SETTLED, actualCostToDate: 100_000 }), money)).toBe(
      "Cost exactly what it was bid at.",
    );
  });
});

describe("the record across several bids", () => {
  const over = bidOutcome({ ...SETTLED, actualCostToDate: 110_000 });   // +10%
  const under = bidOutcome({ ...SETTLED, actualCostToDate: 90_000 });   // -10%
  const pending = bidOutcome({ ...SETTLED, jobStatus: "IN_PROGRESS" });
  const unknowable = bidOutcome({ ...SETTLED, bidAmount: null });

  it("averages only the settled ones and counts the rest separately", () => {
    // The defect this guards: treating an unfinished job as on-budget. That
    // reads fine and is wrong — the same shape as counting a dead verify
    // agent as a refutation.
    const record = bidRecord([over, under, pending, unknowable]);
    expect(record.settled).toBe(2);
    expect(record.notYet).toBe(2);
    expect(record.averageVariance).toBeCloseTo(0, 6);
    expect(record.over).toBe(1);
    expect(record.under).toBe(1);
  });

  it("reports no average at all when nothing has settled", () => {
    const record = bidRecord([pending, unknowable]);
    expect(record.settled).toBe(0);
    expect(record.averageVariance).toBeNull();
    expect(record.notYet).toBe(2);
  });

  it("is empty-safe", () => {
    expect(bidRecord([])).toEqual({ settled: 0, notYet: 0, averageVariance: null, over: 0, under: 0 });
  });
});
