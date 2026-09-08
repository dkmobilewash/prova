import { describe, expect, it } from "vitest";
import {
  catalogActuals,
  CATALOG_MIN_SAMPLE,
  CATALOG_VARIANCE_THRESHOLD,
  repriceDecision,
  type JobStatusForActuals,
} from "./catalog-actuals";

/** A costed line on a FINISHED job — the only kind that counts toward an
 * actual unit cost. See the "jobs that are still running" suite below for
 * why a running job's cost does not belong in this arithmetic at all. */
const line = (
  quantity: number,
  actualCost: number,
  hasCosts = true,
  jobStatus: JobStatusForActuals = "COMPLETE",
) => ({
  quantity,
  actualCost,
  hasCosts,
  jobStatus,
});

const runningLine = (quantity: number, actualCost: number) => line(quantity, actualCost, true, "IN_PROGRESS");

describe("catalogActuals", () => {
  it("reports nothing when no line has been costed", () => {
    const result = catalogActuals([line(100, 0, false)], 5);
    expect(result.actualUnitCost).toBeNull();
    expect(result.variance).toBeNull();
    expect(result.isFlagged).toBe(false);
  });

  it("weights by quantity rather than averaging per-line rates", () => {
    // 500 SF at $2/SF and 5 SF at $20/SF. Averaging the two rates gives $11;
    // the truthful figure is total cost over total quantity — $1,100 / 505.
    const result = catalogActuals([line(500, 1000), line(5, 100)], 2);
    expect(result.actualUnitCost).toBeCloseTo(1100 / 505, 6);
    expect(result.actualUnitCost).not.toBeCloseTo(11, 1);
  });

  it("computes variance against the default", () => {
    const result = catalogActuals([line(100, 600), line(100, 600)], 5);
    expect(result.actualUnitCost).toBe(6);
    expect(result.variance).toBe(1);
    expect(result.variancePct).toBeCloseTo(0.2, 6);
    expect(result.isFlagged).toBe(true);
  });

  it("flags under-running entries too, not just over-runs", () => {
    // A default priced well above reality loses work by overbidding — just
    // as worth surfacing as one that loses money by underbidding.
    const result = catalogActuals([line(100, 400), line(100, 400)], 5);
    expect(result.variancePct).toBeCloseTo(-0.2, 6);
    expect(result.isFlagged).toBe(true);
  });

  it("does not flag drift inside the threshold", () => {
    const result = catalogActuals([line(100, 510), line(100, 510)], 5);
    expect(Math.abs(result.variancePct!)).toBeLessThan(CATALOG_VARIANCE_THRESHOLD);
    expect(result.isFlagged).toBe(false);
  });

  it("never flags on a single job, however far off it is", () => {
    // One bad job is an anecdote. Re-pricing the catalog from it would
    // propagate that job's problem into every future bid.
    const result = catalogActuals([line(100, 5000)], 5);
    expect(result.linesWithCosts).toBe(1);
    expect(result.linesWithCosts).toBeLessThan(CATALOG_MIN_SAMPLE);
    expect(result.variancePct).toBeCloseTo(9, 6);
    expect(result.isFlagged).toBe(false);
  });

  it("reports actuals but never flags when the entry has no default to compare against", () => {
    const result = catalogActuals([line(100, 600), line(100, 600)], null);
    expect(result.actualUnitCost).toBe(6);
    expect(result.variance).toBeNull();
    expect(result.isFlagged).toBe(false);
  });

  it("does not divide by zero on a free default or zero quantities", () => {
    expect(catalogActuals([line(100, 600), line(100, 600)], 0).variancePct).toBeNull();
    expect(catalogActuals([line(0, 600), line(0, 600)], 5).actualUnitCost).toBeNull();
  });

  it("ignores uncosted lines when sizing the sample", () => {
    // Two lines exist but only one has costs — still an anecdote.
    const result = catalogActuals([line(100, 5000), line(100, 0, false)], 5);
    expect(result.linesWithCosts).toBe(1);
    expect(result.isFlagged).toBe(false);
  });
});

describe("jobs that are still running (#105 finding 2)", () => {
  // The defect was one-directional, which is what made it dangerous. Cost
  // lands on a line over the months the work takes; quantity is the whole
  // scope from day one. Every unfinished job therefore reads LOW, the
  // errors reinforce instead of cancelling, and "update default from
  // actuals" walks the catalog toward zero the more often anyone clicks it.

  it("does not price a template off work that is only part built", () => {
    // Hand-worked: two FINISHED 1,000 SF lines, truly running at $2.00/SF,
    // cost $2,000 each. Two more 1,000 SF lines are 40% built, so $800 of
    // cost has landed on each so far. Counting all four gives
    // $5,600 / 4,000 SF = $1.40/SF — 30% under, amber, one click from
    // becoming the default. The finished two alone give the truth: $2.00/SF.
    const result = catalogActuals(
      [line(1000, 2000), line(1000, 2000), runningLine(1000, 800), runningLine(1000, 800)],
      2,
    );

    expect(result.actualUnitCost).toBe(2);
    expect(result.linesWithCosts).toBe(2);
    expect(result.linesExcludedUnfinished).toBe(2);
    expect(result.variance).toBe(0);
    expect(result.isFlagged).toBe(false);

    // What the old (buggy) arithmetic said, spelled out so the fix cannot
    // silently regress: 5600 / 4000 = 1.4, not 2.
    expect(result.actualUnitCost).not.toBeCloseTo(5600 / 4000, 6);
  });

  it("reports nothing at all when every costed job is still running", () => {
    const result = catalogActuals([runningLine(1000, 800), runningLine(1000, 800)], 2);
    expect(result.actualUnitCost).toBeNull();
    expect(result.linesWithCosts).toBe(0);
    expect(result.linesExcludedUnfinished).toBe(2);
    expect(result.isFlagged).toBe(false);
  });

  it("excludes a contracted job that has not started, and an estimate", () => {
    const result = catalogActuals(
      [line(100, 600, true, "CONTRACTED"), line(100, 600, true, "ESTIMATE")],
      5,
    );
    expect(result.actualUnitCost).toBeNull();
    expect(result.linesExcludedUnfinished).toBe(2);
  });

  it("counts an uncosted running job as neither sample nor exclusion", () => {
    // Nothing has been booked against it, so there is nothing to leave out —
    // reporting "1 line excluded" here would report an absence as evidence.
    const result = catalogActuals([line(100, 600), line(100, 600), line(100, 0, false, "IN_PROGRESS")], 5);
    expect(result.linesWithCosts).toBe(2);
    expect(result.linesExcludedUnfinished).toBe(0);
  });
});

describe("repriceDecision (#105 finding 3)", () => {
  /**
   * The write side: what "update default from actuals" actually sets.
   *
   * The defect this keeps dead is one of provenance, not arithmetic:
   * `actualUnitCost` used to arrive in a hidden input and get written after
   * being checked only for parsing as a number, on the one control in the
   * app that edits a price every future bid and every AI draft reads. The
   * fix is in this function's SIGNATURE — there is no argument a
   * browser-supplied figure could come in through. Every assertion below is
   * on a number derived from the lines.
   */

  // Two FINISHED lines at a true $2.00/SF, against a default of $5.00 — 60%
  // under, comfortably past CATALOG_VARIANCE_THRESHOLD, so flagged.
  const flagged = catalogActuals([line(1000, 2000), line(1000, 2000)], 5);

  it("writes the cost it derived from the lines, to the cent", () => {
    expect(flagged.isFlagged).toBe(true);
    expect(repriceDecision(flagged, null, false)).toEqual({
      ok: true,
      defaultBudgetedUnitCost: "2.00",
    });
  });

  it("leaves the sale price alone unless asked", () => {
    // Cost is a fact the jobs measured; price is a margin call belonging to
    // the estimator. "Our cost went up 20%" must not silently become "we now
    // charge 20% more".
    const result = repriceDecision(flagged, 8, false);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.defaultUnitPrice).toBeUndefined();
  });

  it("holds the margin when asked, rather than collapsing price to cost", () => {
    // Hand-worked: default cost $5.00 carried a price of $8.00, a margin
    // multiple of 1.6. The new cost is $2.00, so the held price is
    // 1.6 * 2.00 = $3.20 — NOT $2.00, which would give the work away.
    expect(repriceDecision(flagged, 8, true)).toEqual({
      ok: true,
      defaultBudgetedUnitCost: "2.00",
      defaultUnitPrice: "3.20",
    });
  });

  it("invents no price when there is no margin to hold", () => {
    // No prior price, so there is no margin. Inventing one would be a
    // pricing decision this has no business making; the cost still moves.
    const result = repriceDecision(flagged, null, true);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.defaultUnitPrice).toBeUndefined();
  });

  it("refuses when no FINISHED job has costed this entry", () => {
    // And says which of the two situations it is — "nothing has used this
    // entry" and "things have used it and none has finished" call for
    // different next steps.
    const onlyRunning = catalogActuals([runningLine(1000, 800), runningLine(1000, 800)], 2);
    const result = repriceDecision(onlyRunning, null, false);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("finished");

    const nothingAtAll = catalogActuals([line(100, 0, false)], 2);
    const none = repriceDecision(nothingAtAll, null, false);
    expect(none.ok).toBe(false);
    if (none.ok) throw new Error("unreachable");
    expect(none.error).toContain("no finished job has used this entry");
  });

  it("refuses when the entry is no longer far enough off to be worth changing", () => {
    // The re-check that makes the hidden input unnecessary in the first
    // place: the page that rendered the button may be minutes old, and a
    // costed line landing since can move the entry back inside the
    // threshold — at which point the click must do nothing.
    const onTarget = catalogActuals([line(1000, 2000), line(1000, 2000)], 2);
    expect(onTarget.isFlagged).toBe(false);

    const result = repriceDecision(onTarget, null, false);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("reload the page");
  });

  it("refuses on a single costed line, however far off it is", () => {
    // CATALOG_MIN_SAMPLE, enforced on the WRITE and not only on the badge.
    const oneLine = catalogActuals([line(1000, 2000)], 5);
    expect(oneLine.actualUnitCost).toBe(2);
    expect(repriceDecision(oneLine, null, false).ok).toBe(false);
  });

  it("mutation guard: reverting to reading the browser's number would make this whole suite meaningless", () => {
    // There is no argument here a caller could substitute to change the
    // written cost — it is entirely a function of `actuals`. Confirms the
    // written value tracks a changed input rather than a hardcoded string.
    const differentActuals = catalogActuals([line(1000, 900), line(1000, 900)], 5);
    const decision = repriceDecision(differentActuals, null, false);
    expect(decision.ok).toBe(true);
    if (!decision.ok) throw new Error("unreachable");
    expect(decision.defaultBudgetedUnitCost).toBe("0.90");
  });
});
