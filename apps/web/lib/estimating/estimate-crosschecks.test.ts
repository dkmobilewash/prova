import { describe as group, expect, it } from "vitest";
import {
  carriedQuotesMissing,
  estimateCrossChecks,
  measuredNotPosted,
  type CrossCheckCarriedQuote,
  type CrossCheckLine,
  type CrossCheckMeasurement,
} from "./estimate-crosschecks";

/**
 * The first checks in this repo of the shape "a quantity here implies a line
 * there, and there is none".
 *
 * The hardest thing to get right is not the positive case — it is staying
 * QUIET. Twelve advisory checks already run on an estimate, and a thirteenth
 * that fires when nothing is wrong would teach people to stop reading all of
 * them (#616's rule). So most of what is below is silence, asserted.
 */

const measurement = (over: Partial<CrossCheckMeasurement> = {}): CrossCheckMeasurement => ({
  id: "m1",
  kind: "LINEAR",
  label: "Level 2 partitions",
  postedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const quote = (over: Partial<CrossCheckCarriedQuote> = {}): CrossCheckCarriedQuote => ({
  vendorName: "Alpha Drywall",
  packageLabel: "Metal stud framing",
  amount: 61_500,
  expectedDescription: "Metal stud framing — Alpha Drywall",
  ...over,
});

const line = (over: Partial<CrossCheckLine> = {}): CrossCheckLine => ({
  description: "Something else",
  costCategory: "MATERIAL",
  budgetedUnitCost: 12.5,
  ...over,
});

group("traced on the drawing, never priced", () => {
  it("says nothing when every measurement has been posted", () => {
    expect(measuredNotPosted([measurement(), measurement({ id: "m2" })])).toBeNull();
  });

  it("says nothing on an estimate with no measurements at all", () => {
    // A typed estimate is not an incomplete one. Most jobs never open the
    // takeoff tool, and a warning here would fire on all of them.
    expect(measuredNotPosted([])).toBeNull();
  });

  it("NAMES THE UNPOSTED ONES, because the label is what makes it actionable", () => {
    const check = measuredNotPosted([
      measurement({ id: "m1", postedAt: null, label: "Level 2 partitions" }),
      measurement({ id: "m2", postedAt: null, label: "Corridor ceiling" }),
      measurement({ id: "m3" }),
    ]);
    expect(check?.kind).toBe("MEASURED_NOT_POSTED");
    expect(check?.sentence).toContain("Level 2 partitions and Corridor ceiling");
    // Two, not three — the posted one is not a finding.
    expect(check?.sentence).toContain("2 traced measurements are");
  });

  it("counts unnamed measurements rather than inventing names for them", () => {
    const check = measuredNotPosted([
      measurement({ id: "m1", postedAt: null, label: "Level 2 partitions" }),
      measurement({ id: "m2", postedAt: null, label: null }),
      measurement({ id: "m3", postedAt: null, label: "   " }),
    ]);
    expect(check?.sentence).toContain("Level 2 partitions, and 2 unnamed");
  });

  it("reads as one thing when there is one", () => {
    const check = measuredNotPosted([measurement({ postedAt: null })]);
    expect(check?.sentence).toContain("1 traced measurement is");
  });

  it("CARRIES NO QUANTITY, deliberately", () => {
    // A length only exists relative to its calibration, and a figure here that
    // disagreed with the takeoff tab's own by a foot would be worse than none.
    const check = measuredNotPosted([measurement({ postedAt: null, label: "Level 2 partitions" })]);
    expect(check?.sentence).not.toMatch(/\d+\s*(LF|SF|ft|sq)/i);
  });
});

group("a carried price that never reached the estimate", () => {
  it("says nothing when nothing was carried", () => {
    expect(carriedQuotesMissing([], [line()])).toBeNull();
  });

  it("FLAGS A CARRIED QUOTE WITH NO LINE, naming the vendor and the package", () => {
    const check = carriedQuotesMissing([quote()], [line()]);
    expect(check?.kind).toBe("CARRIED_QUOTE_MISSING");
    expect(check?.sentence).toContain("Alpha Drywall for Metal stud framing");
    expect(check?.sentence).toContain("the bid is short");
  });

  it("is satisfied by the exact description the app would have written", () => {
    const posted = line({ description: "Metal stud framing — Alpha Drywall", costCategory: "SUBCONTRACTOR" });
    expect(carriedQuotesMissing([quote()], [posted])).toBeNull();
  });

  it("IS ALSO SATISFIED BY A RENAMED LINE AT THE SAME COST, which is the anti-cry-wolf half", () => {
    // An estimator who renamed the line still has a correct estimate. One
    // signal would have told them forever that the quote was missing.
    const renamed = line({ description: "Framing subcontract — see Alpha", costCategory: "SUBCONTRACTOR", budgetedUnitCost: 61_500 });
    expect(carriedQuotesMissing([quote()], [renamed])).toBeNull();
  });

  it("does NOT accept a matching cost under another category", () => {
    // A $61,500 MATERIAL line is not a subcontract. Accepting it would make
    // the amount match do the categorising, which is the guess this file
    // refuses everywhere else.
    const wrongCategory = line({ description: "Board", costCategory: "MATERIAL", budgetedUnitCost: 61_500 });
    expect(carriedQuotesMissing([quote()], [wrongCategory])?.kind).toBe("CARRIED_QUOTE_MISSING");
  });

  it("compares money in whole cents, so a float bit cannot hide a miss", () => {
    const odd = quote({ amount: 61_500.1 });
    const exact = line({ description: "x", costCategory: "SUBCONTRACTOR", budgetedUnitCost: 61_500.1 });
    expect(carriedQuotesMissing([odd], [exact])).toBeNull();
    const off = line({ description: "x", costCategory: "SUBCONTRACTOR", budgetedUnitCost: 61_500.11 });
    expect(carriedQuotesMissing([odd], [off])?.kind).toBe("CARRIED_QUOTE_MISSING");
  });

  it("reports several, and reads as plural", () => {
    const beta = quote({ vendorName: "Beta", packageLabel: "EIFS", amount: 40_000, expectedDescription: "EIFS — Beta" });
    const check = carriedQuotesMissing([quote(), beta], []);
    expect(check?.sentence).toContain("Alpha Drywall for Metal stud framing and Beta for EIFS");
    expect(check?.sentence).toContain("are not on");
    expect(check?.sentence).toContain("those quotes");
  });

  it("flags only the missing one when another is posted", () => {
    const beta = quote({ vendorName: "Beta", packageLabel: "EIFS", amount: 40_000, expectedDescription: "EIFS — Beta" });
    const check = carriedQuotesMissing([quote(), beta], [line({ description: "EIFS — Beta" })]);
    expect(check?.sentence).toContain("Alpha Drywall");
    expect(check?.sentence).not.toContain("Beta");
  });
});

group("what the panel says, in order", () => {
  it("puts the carried quote before the measurement", () => {
    // Money already decided, ahead of work that may yet be deliberately
    // excluded.
    const checks = estimateCrossChecks({
      measurements: [measurement({ postedAt: null })],
      carried: [quote()],
      lines: [],
    });
    expect(checks.map((c) => c.kind)).toEqual(["CARRIED_QUOTE_MISSING", "MEASURED_NOT_POSTED"]);
  });

  it("RETURNS AN EMPTY LIST AND NEVER A VERDICT on a clean estimate", () => {
    // No "looks complete". This module cannot see what is missing that it has
    // no rule for, so saying nothing is wrong would be a claim about work it
    // never examined — `bid-responsiveness.ts`'s position.
    const checks = estimateCrossChecks({
      measurements: [measurement()],
      carried: [quote()],
      lines: [line({ description: "Metal stud framing — Alpha Drywall" })],
    });
    expect(checks).toEqual([]);
  });

  it("is silent on an estimate that has nothing to cross-check", () => {
    expect(estimateCrossChecks({ measurements: [], carried: [], lines: [] })).toEqual([]);
  });
});
