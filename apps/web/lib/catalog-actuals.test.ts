import { describe, expect, it } from "vitest";
import {
  catalogActuals,
  catalogSourcedLine,
  CATALOG_MIN_SAMPLE,
  CATALOG_VARIANCE_THRESHOLD,
  repriceDecision,
  type CatalogSourcedLine,
  type JobStatusForActuals,
} from "./catalog-actuals";

/** A costed line on a FINISHED job — the only kind that counts toward an
 * actual unit cost. See the "jobs that are still running" suite below for
 * why a running job's cost does not belong in this arithmetic at all.
 *
 * Carries NO labor, which is what every case written before #287's fix
 * reached this file assumed a line was. The labor suite below builds its own. */
const line = (
  quantity: number,
  costEntryTotal: number,
  hasCosts = true,
  jobStatus: JobStatusForActuals = "COMPLETE",
): CatalogSourcedLine => ({
  quantity,
  costEntryTotal,
  costEntryCount: hasCosts ? 1 : 0,
  laborCostEntryTotal: 0,
  laborCost: 0,
  laborHours: 0,
  unpricedLaborHours: 0,
  jobStatus,
});

const runningLine = (quantity: number, costEntryTotal: number) =>
  line(quantity, costEntryTotal, true, "IN_PROGRESS");

/** A line with hours booked against it — the ordinary shape of a
 * self-performed framing/drywall line, and the shape this file could not
 * see at all until #287's fix was extended to the catalog. */
const selfPerformedLine = (input: {
  quantity: number;
  costEntryTotal?: number;
  costEntryCount?: number;
  /** The LABOR-category slice of costEntryTotal — the overlap that makes a
   * line ambiguous evidence once hours are logged against it too. */
  laborCostEntryTotal?: number;
  laborCost: number;
  laborHours: number;
  unpricedLaborHours?: number;
  jobStatus?: JobStatusForActuals;
}): CatalogSourcedLine => ({
  quantity: input.quantity,
  costEntryTotal: input.costEntryTotal ?? 0,
  costEntryCount: input.costEntryCount ?? (input.costEntryTotal ? 1 : 0),
  laborCostEntryTotal: input.laborCostEntryTotal ?? 0,
  laborCost: input.laborCost,
  laborHours: input.laborHours,
  unpricedLaborHours: input.unpricedLaborHours ?? 0,
  jobStatus: input.jobStatus ?? "COMPLETE",
});

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

describe("logged hours are part of what the work cost (#287, catalog half)", () => {
  // #287 put burdened labor into job cost, WIP and percent complete. It did
  // not reach this file, and this file is the one that WRITES a number back:
  // "Update default from actuals" sets defaultBudgetedUnitCost, which prices
  // every future bid and grounds every AI draft.
  //
  // The bias is the same one #105 finding 2 documents above, and for the same
  // structural reason: labor is most of a self-performed line's cost, so
  // leaving it out can only push the derived unit cost DOWN. Errors reinforce
  // instead of cancelling, and each click walks the catalog nearer to
  // materials-only.

  it("counts burdened labor against the line, not only its cost entries", () => {
    // Hand-worked: two finished 1,000 SF lines. $500 of board and screws
    // booked as cost entries, $1,500 of burdened crew time logged as hours.
    // True cost is $2,000 a line, so $2.00/SF.
    const lines = [
      selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 1500, laborHours: 40 }),
      selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 1500, laborHours: 40 }),
    ];
    const result = catalogActuals(lines, 2);

    expect(result.actualUnitCost).toBe(2);
    expect(result.variance).toBe(0);
    expect(result.isFlagged).toBe(false);

    // What the pre-fix arithmetic said, spelled out so it cannot come back:
    // $1,000 / 2,000 SF = $0.50/SF — 75% under, amber, and one click from
    // becoming the default that prices the next bid.
    expect(result.actualUnitCost).not.toBeCloseTo(0.5, 6);
  });

  it("treats a line with only logged hours as costed at all", () => {
    // A self-performed line often has NO CostEntry rows whatsoever — the
    // crew's time is the cost. Sampling on cost entries alone did not merely
    // understate this line, it dropped it out of the sample entirely, so the
    // catalog learned nothing from the jobs it most needed to learn from.
    const result = catalogActuals(
      [
        selfPerformedLine({ quantity: 1000, laborCost: 2000, laborHours: 50 }),
        selfPerformedLine({ quantity: 1000, laborCost: 2000, laborHours: 50 }),
      ],
      5,
    );

    expect(result.linesWithCosts).toBe(2);
    expect(result.actualUnitCost).toBe(2);
    expect(result.isFlagged).toBe(true);
  });

  it("reports the labor inside the figure rather than burying it", () => {
    const result = catalogActuals(
      [
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 1500, laborHours: 40 }),
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 1500, laborHours: 40 }),
      ],
      2,
    );
    expect(result.laborCost).toBe(3000);
    expect(result.costEntryTotal).toBe(1000);
  });

  it("excludes a line whose hours no wage schedule could price, and says how many", () => {
    // labor-cost.ts refuses to guess a rate when no FringeRateSchedule covers
    // an entry's craft and date. "Refused to guess" and "cost nothing" read
    // identically in a total, so those hours must not be averaged in at $0 —
    // that is precisely the understatement this suite exists to stop.
    const result = catalogActuals(
      [
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 1500, laborHours: 40 }),
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 1500, laborHours: 40 }),
        selfPerformedLine({
          quantity: 1000,
          costEntryTotal: 500,
          laborCost: 0,
          laborHours: 40,
          unpricedLaborHours: 40,
        }),
      ],
      2,
    );

    expect(result.linesWithCosts).toBe(2);
    expect(result.linesExcludedUnpricedHours).toBe(1);
    expect(result.actualUnitCost).toBe(2);
    // Counting the third line would give $4,000 / 3,000 SF = $1.33/SF.
    expect(result.actualUnitCost).not.toBeCloseTo(4000 / 3000, 6);
  });

  it("reports nothing when every costed line has hours nobody can price", () => {
    const result = catalogActuals(
      [
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 0, laborHours: 40, unpricedLaborHours: 40 }),
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 0, laborHours: 40, unpricedLaborHours: 40 }),
      ],
      2,
    );
    expect(result.actualUnitCost).toBeNull();
    expect(result.linesWithCosts).toBe(0);
    expect(result.linesExcludedUnpricedHours).toBe(2);
    expect(result.isFlagged).toBe(false);
  });

  it("counts an unfinished job as unfinished, not as unpriced, when it is both", () => {
    // The two exclusions must not double-count the same line, or the caveat
    // on screen claims more evidence was set aside than exists.
    const result = catalogActuals(
      [
        selfPerformedLine({
          quantity: 1000,
          costEntryTotal: 500,
          laborCost: 0,
          laborHours: 40,
          unpricedLaborHours: 40,
          jobStatus: "IN_PROGRESS",
        }),
      ],
      2,
    );
    expect(result.linesExcludedUnfinished).toBe(1);
    expect(result.linesExcludedUnpricedHours).toBe(0);
  });

  it("counts the two exclusions separately when both kinds are present", () => {
    // The case that distinguishes the two subtractions. With only ONE line
    // that is both unfinished AND unpriced, "costedAnywhere - costed" and
    // "costedAnywhere - finished" give the same answer, so a test built from
    // that case cannot tell a correct split from one that double-counts the
    // same line into both figures. Two lines, one of each kind, can.
    const result = catalogActuals(
      [
        // finished, but its hours have no rate
        selfPerformedLine({
          quantity: 1000,
          costEntryTotal: 500,
          laborCost: 0,
          laborHours: 40,
          unpricedLaborHours: 40,
        }),
        // still running, every hour priced
        selfPerformedLine({
          quantity: 1000,
          costEntryTotal: 500,
          laborCost: 1500,
          laborHours: 40,
          jobStatus: "IN_PROGRESS",
        }),
      ],
      2,
    );

    expect(result.linesWithCosts).toBe(0);
    expect(result.linesExcludedUnfinished).toBe(1);
    expect(result.linesExcludedUnpricedHours).toBe(1);
    // Two costed lines in, two accounted for — no line counted twice and
    // none lost.
    expect(result.linesWithCosts + result.linesExcludedUnfinished + result.linesExcludedUnpricedHours).toBe(2);
  });

  it("leaves a line with no hours at all completely unaffected", () => {
    // A subcontracted or material-only line has zero hours and zero unpriced
    // hours; nothing above may change what it reports.
    const result = catalogActuals([line(100, 600), line(100, 600)], 5);
    expect(result.actualUnitCost).toBe(6);
    expect(result.linesExcludedUnpricedHours).toBe(0);
    expect(result.laborCost).toBe(0);
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

  it("refuses to write a default off hours nobody could price, and names that reason", () => {
    // The worst possible moment to be vague: this is the write that prices
    // the next bid. "No finished job has used this entry" would send the
    // estimator looking for jobs; the real fix is a wage schedule.
    const allUnpriced = catalogActuals(
      [
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 0, laborHours: 40, unpricedLaborHours: 40 }),
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 0, laborHours: 40, unpricedLaborHours: 40 }),
      ],
      2,
    );
    const result = repriceDecision(allUnpriced, null, false);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("wage rate");
    expect(result.error).not.toContain("no finished job has used this entry");
  });

  it("writes a cost that includes the crew's time", () => {
    // The end-to-end of this fix, on the one control that writes: two
    // finished 1,000 SF lines at $500 material + $1,500 labor against a $5.00
    // default. The written figure must be 2.00, not the 0.50 a
    // cost-entries-only sample would have produced.
    const selfPerformed = catalogActuals(
      [
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 1500, laborHours: 40 }),
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 1500, laborHours: 40 }),
      ],
      5,
    );
    expect(repriceDecision(selfPerformed, null, false)).toEqual({
      ok: true,
      defaultBudgetedUnitCost: "2.00",
    });
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

describe("catalogSourcedLine: turning a row into a costed line (#287)", () => {
  // The page RENDERS this and the re-price action WRITES from it. One
  // function, so a badge and the button under it cannot disagree — and these
  // are the tests that say the function actually reads the hours rather than
  // merely being named as though it does.
  const CARPENTER = "craft_carpenter";
  const schedules = new Map([
    [
      CARPENTER,
      [
        {
          baseWage: 40,
          pensionRate: 5,
          vacationRate: 3,
          healthWelfareRate: 2,
          trainingRate: 0,
          effectiveFrom: new Date("2026-01-01T00:00:00Z"),
          effectiveTo: null,
        },
      ],
    ],
  ]);

  const entry = (over: Record<string, unknown> = {}) => ({
    lineItemId: "li_1",
    craftClassificationId: CARPENTER,
    date: new Date("2026-06-01T00:00:00Z"),
    hours: 10,
    payType: "STRAIGHT" as const,
    perDiemAmount: null,
    travelPayAmount: null,
    ...over,
  });

  const row = (over: Record<string, unknown> = {}) => ({
    quantity: 1000,
    costEntries: [{ amount: 500, category: "MATERIAL" }],
    timeEntries: [entry()],
    job: { status: "COMPLETE" },
    ...over,
  });

  it("reads the hours, at $50/hr burdened", () => {
    const line = catalogSourcedLine(row(), schedules);
    expect(line.laborCost).toBe(500);
    expect(line.costEntryTotal).toBe(500);
    expect(line.laborHours).toBe(10);
    expect(line.unpricedLaborHours).toBe(0);
  });

  it("counts hours no schedule covers as hours, with no dollars", () => {
    const line = catalogSourcedLine(
      row({ timeEntries: [entry({ craftClassificationId: "craft_unknown", hours: 6 })] }),
      schedules,
    );
    expect(line.laborCost).toBe(0);
    expect(line.laborHours).toBe(6);
    expect(line.unpricedLaborHours).toBe(6);
  });

  it("makes a line with hours and no cost entries a COSTED line", () => {
    const line = catalogSourcedLine(row({ costEntries: [] }), schedules);
    expect(line.costEntryCount).toBe(0);
    expect(line.laborHours).toBe(10);
    // The whole point: catalogActuals must not drop this line.
    expect(catalogActuals([line, line], 5).linesWithCosts).toBe(2);
  });

  it("carries the job status through, so #105's unfinished rule still applies", () => {
    expect(catalogSourcedLine(row({ job: { status: "IN_PROGRESS" } }), schedules).jobStatus).toBe(
      "IN_PROGRESS",
    );
  });
});

describe("a line that counts its labor twice is not evidence (#287 review)", () => {
  // THE LEDGER RULE DOES NOT TRANSFER HERE, and that is the whole point of
  // this suite.
  //
  // `lineItemCostToDate` ADDS logged hours to manual cost entries and lets a
  // duplicate stand, deliberately: on /jobs/[id] that is a ledger, nothing can
  // tell a duplicate from two real costs, and hiding money somebody entered
  // would be worse than showing it twice.
  //
  // The catalog is not a ledger. It is a SAMPLE the app learns a unit cost
  // from and then WRITES into `defaultBudgetedUnitCost`, which prices every
  // future bid. The question stops being "is this money real?" and becomes
  // "is this line interpretable as a unit cost?" — and a line carrying both
  // priced hours and LABOR-category cost entries is not. It is either two
  // genuine labor costs (own crew plus a labor-only sub invoice) or the same
  // labor entered twice, and nothing in the schema distinguishes them.
  //
  // Which is exactly the predicate this file already applies twice: an
  // unfinished job's cost is real but is not a unit cost, and unpriced hours
  // are real hours but are not dollars. Both are excluded and named. This is
  // the third member of that family, not a new rule.
  //
  // The asymmetry that decides it: exclusion is visible and recoverable — the
  // badge says why, and recategorising the entry or finishing another job
  // fixes it. A doubled figure written into the catalog is silent, compounds
  // on every reprice, and prices bids HIGH, which loses work rather than
  // losing money on work. A contractor gets no signal from a bid they didn't win.

  const ambiguous = (over: Record<string, unknown> = {}) =>
    selfPerformedLine({
      quantity: 1000,
      costEntryTotal: 1500,
      laborCostEntryTotal: 1500,
      laborCost: 1500,
      laborHours: 30,
      ...over,
    });

  it("excludes the line and names why", () => {
    const result = catalogActuals(
      [
        ambiguous(),
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 1500, laborHours: 30 }),
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 1500, laborHours: 30 }),
      ],
      2,
    );

    expect(result.linesWithCosts).toBe(2);
    expect(result.linesExcludedDoubleCountedLabor).toBe(1);
    expect(result.actualUnitCost).toBe(2);
    // Counting it at face value: $4,000 + $3,000 over 3,000 SF = $2.33/SF —
    // 17% HIGH, past the flag threshold, and one click from being banked.
    expect(result.actualUnitCost).not.toBeCloseTo(7000 / 3000, 6);
  });

  it("leaves a LABOR cost entry alone when no hours were logged", () => {
    // A contractor who tracks labor purely as cost entries is unambiguous.
    // Excluding them would refuse to learn from a perfectly clear line.
    const result = catalogActuals(
      [
        selfPerformedLine({ quantity: 1000, costEntryTotal: 2000, laborCostEntryTotal: 2000, laborCost: 0, laborHours: 0 }),
        selfPerformedLine({ quantity: 1000, costEntryTotal: 2000, laborCostEntryTotal: 2000, laborCost: 0, laborHours: 0 }),
      ],
      5,
    );
    expect(result.linesWithCosts).toBe(2);
    expect(result.linesExcludedDoubleCountedLabor).toBe(0);
    expect(result.actualUnitCost).toBe(2);
  });

  it("leaves logged hours alone when no LABOR cost entry sits beside them", () => {
    const result = catalogActuals(
      [
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCostEntryTotal: 0, laborCost: 1500, laborHours: 30 }),
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCostEntryTotal: 0, laborCost: 1500, laborHours: 30 }),
      ],
      5,
    );
    expect(result.linesWithCosts).toBe(2);
    expect(result.linesExcludedDoubleCountedLabor).toBe(0);
  });

  it("does not exclude over a zero-dollar LABOR entry", () => {
    // No dollars, no double count. Excluding on the mere presence of a row
    // would throw away a line for nothing.
    const result = catalogActuals(
      [
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCostEntryTotal: 0, costEntryCount: 2, laborCost: 1500, laborHours: 30 }),
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCostEntryTotal: 0, costEntryCount: 2, laborCost: 1500, laborHours: 30 }),
      ],
      5,
    );
    expect(result.linesExcludedDoubleCountedLabor).toBe(0);
    expect(result.linesWithCosts).toBe(2);
  });

  it("does not exclude when the hours could not be priced — they added no dollars", () => {
    // Unpriced hours contribute nothing, so there is nothing to double. That
    // line is already excluded for the OTHER reason, and must be counted
    // under one heading, not two.
    const result = catalogActuals(
      [ambiguous({ laborCost: 0, unpricedLaborHours: 30 })],
      2,
    );
    expect(result.linesExcludedUnpricedHours).toBe(1);
    expect(result.linesExcludedDoubleCountedLabor).toBe(0);
  });

  it("excludes a per-diem-only day beside a Labor cost entry — dollars, not hours", () => {
    // The case that distinguishes `laborCost > 0` from `laborHours > 0`, and
    // the reason the predicate is written in DOLLARS.
    //
    // A travel or per-diem day is a TimeEntry with no hours on it:
    // calculateBurdenedLaborCost adds the allowance regardless of hours, so
    // the line carries labor MONEY and zero labor HOURS. Asking "were hours
    // logged?" answers no and lets the line through; asking "did labor
    // dollars land here?" answers yes, which is the question that matters
    // when a payroll import may have booked that same per diem as a
    // Labor-category cost entry too.
    const perDiemOnly = selfPerformedLine({
      quantity: 1000,
      costEntryTotal: 1500,
      laborCostEntryTotal: 1500,
      laborCost: 250,
      laborHours: 0,
    });
    const result = catalogActuals([perDiemOnly, perDiemOnly], 2);
    expect(result.linesExcludedDoubleCountedLabor).toBe(2);
    expect(result.actualUnitCost).toBeNull();
  });

  it("reports every costed line under exactly one heading", () => {
    const result = catalogActuals(
      [
        ambiguous(),
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 0, laborHours: 30, unpricedLaborHours: 30 }),
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 1500, laborHours: 30, jobStatus: "IN_PROGRESS" }),
        selfPerformedLine({ quantity: 1000, costEntryTotal: 500, laborCost: 1500, laborHours: 30 }),
      ],
      2,
    );
    expect(result.linesWithCosts).toBe(1);
    expect(result.linesExcludedUnfinished).toBe(1);
    expect(result.linesExcludedUnpricedHours).toBe(1);
    expect(result.linesExcludedDoubleCountedLabor).toBe(1);
    expect(
      result.linesWithCosts +
        result.linesExcludedUnfinished +
        result.linesExcludedUnpricedHours +
        result.linesExcludedDoubleCountedLabor,
    ).toBe(4);
  });

  it("refuses to write a default when every line double-counts, and says how to fix it", () => {
    const allAmbiguous = catalogActuals([ambiguous(), ambiguous()], 2);
    const result = repriceDecision(allAmbiguous, null, false);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("logged hours");
    expect(result.error).not.toContain("no finished job has used this entry");
  });

  it("catalogSourcedLine reads the LABOR slice off the cost entries", () => {
    const CARPENTER = "craft_carpenter";
    const schedules = new Map([
      [
        CARPENTER,
        [
          {
            baseWage: 40,
            pensionRate: 5,
            vacationRate: 3,
            healthWelfareRate: 2,
            trainingRate: 0,
            effectiveFrom: new Date("2026-01-01T00:00:00Z"),
            effectiveTo: null,
          },
        ],
      ],
    ]);
    const line = catalogSourcedLine(
      {
        quantity: 1000,
        costEntries: [
          { amount: 500, category: "MATERIAL" },
          { amount: 1200, category: "LABOR" },
        ],
        timeEntries: [
          {
            lineItemId: "li_1",
            craftClassificationId: CARPENTER,
            date: new Date("2026-06-01T00:00:00Z"),
            hours: 10,
            payType: "STRAIGHT" as const,
            perDiemAmount: null,
            travelPayAmount: null,
          },
        ],
        job: { status: "COMPLETE" },
      },
      schedules,
    );
    expect(line.costEntryTotal).toBe(1700);
    expect(line.laborCostEntryTotal).toBe(1200);
    expect(line.laborCost).toBe(500);
  });
});
