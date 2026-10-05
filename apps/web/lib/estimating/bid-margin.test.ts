import { describe as group, expect, it } from "vitest";
import { bidMargin, formatMarginRate, underCostWarning } from "./bid-margin";
import { bidRecap, type RecapLine, type RecapRates } from "@/lib/bid-recap";
import { money } from "@/lib/money";

/**
 * Does the bid cover what the work costs?
 *
 * Figures are hand-derived in comments, the way `bid-recap.test.ts` does it, so
 * a wrong answer is visible in the file rather than merely absent.
 */

const line = (over: Partial<RecapLine> & { id: string }): RecapLine => ({
  quantity: 1,
  unitCost: 0,
  unitPrice: 0,
  costCategory: null,
  ...over,
});

group("a bid that does not cover its cost", () => {
  it("THE DEFECT: prices below cost are named, with the shortfall in money", () => {
    // $900 of price against $1,000 of cost — $100 under.
    const result = bidMargin([
      line({ id: "a", quantity: 100, unitCost: 10, unitPrice: 9 }),
    ]);
    expect(result.state).toBe("UNDER_COST");
    if (result.state !== "UNDER_COST") return;
    expect(result.priced).toBe(900);
    expect(result.cost).toBe(1000);
    expect(result.shortfall).toBe(100);
    // Against the PRICE: -100/900 = -11.1%, not -10% (which is over cost).
    expect(formatMarginRate(result.rate)).toBe("-11.1%");
  });

  it("fires on a shortfall of one cent, because the sign is the whole claim", () => {
    const result = bidMargin([line({ id: "a", quantity: 1, unitCost: 10.01, unitPrice: 10 })]);
    expect(result.state).toBe("UNDER_COST");
    expect(result.state === "UNDER_COST" && result.shortfall).toBe(0.01);
  });

  it("does NOT fire at exactly cost — breaking even is not under cost", () => {
    const result = bidMargin([line({ id: "a", quantity: 7, unitCost: 10, unitPrice: 10 })]);
    expect(result.state).toBe("COVERED");
    expect(result.state === "COVERED" && result.margin).toBe(0);
    expect(result.state === "COVERED" && formatMarginRate(result.rate)).toBe("0.0%");
  });

  it("reports a healthy bid with its figure rather than staying silent", () => {
    // $1,000 price, $650 cost → $350 margin, 35.0% of the price.
    const result = bidMargin([line({ id: "a", quantity: 100, unitCost: 6.5, unitPrice: 10 })]);
    expect(result.state).toBe("COVERED");
    expect(result.state === "COVERED" && result.margin).toBe(350);
    expect(result.state === "COVERED" && formatMarginRate(result.rate)).toBe("35.0%");
  });
});

group("the cases where there is no margin to report", () => {
  it("says NO_PRICES rather than reading 0% or negative", () => {
    // Cost with nothing priced at all is an estimate in progress, not a bid
    // that loses $1,000. Reporting -100% here would be the loudest wrong
    // number on the screen.
    const result = bidMargin([line({ id: "a", quantity: 100, unitCost: 10, unitPrice: null })]);
    expect(result.state).toBe("NO_PRICES");
    expect(result.cost).toBe(1000);
  });

  it("says NO_COSTS rather than reading 100%", () => {
    // THE HONEST NORMAL CASE, not an edge: a wizard-built, AI-drafted or
    // QuickBooks-sourced job carries prices and no costs, and `bid-recap.ts`
    // says so itself. A 100% margin here would be a fiction.
    const result = bidMargin([line({ id: "a", quantity: 100, unitCost: 0, unitPrice: 10 })]);
    expect(result.state).toBe("NO_COSTS");
    expect(result.priced).toBe(1000);
  });

  it("says NO_PRICES on an empty estimate, never NaN", () => {
    const result = bidMargin([]);
    expect(result.state).toBe("NO_PRICES");
    expect(result.priced).toBe(0);
    expect(result.cost).toBe(0);
  });
});

group("the contaminants are counted, because a bare margin would be a lie", () => {
  it("counts a COST-ONLY line — the false positive this exists to avoid", () => {
    // General conditions: real cost, no price, recovered through the priced
    // lines. Before Apply the recovery is not on the lines yet, so the bid
    // reads under cost on an estimate that is simply unfinished.
    //
    // $900 priced against $1,000 cost ($500 of it on the unpriced line).
    const result = bidMargin([
      line({ id: "priced", quantity: 100, unitCost: 5, unitPrice: 9 }),
      line({ id: "general-conditions", quantity: 1, unitCost: 500, unitPrice: null }),
    ]);
    expect(result.state).toBe("UNDER_COST");
    expect(result.costOnlyLineCount).toBe(1);

    // And the sentence SAYS so, rather than asserting the bid is wrong.
    const sentence = underCostWarning(result, money)!;
    expect(sentence).toContain("1 line carries cost with no price");
    expect(sentence).toContain("recovers through the priced lines");
  });

  it("counts a PRICED-WITH-NO-COST line, which reads the margin high", () => {
    const result = bidMargin([
      line({ id: "costed", quantity: 100, unitCost: 5, unitPrice: 10 }),
      line({ id: "no-cost", quantity: 1, unitCost: 0, unitPrice: 250 }),
    ]);
    expect(result.pricedWithNoCostLineCount).toBe(1);
    // $1,250 priced, $500 cost — the extra $250 of free revenue flatters it.
    expect(result.state === "COVERED" && result.margin).toBe(750);
  });

  it("does not mistake a deliberate ZERO price for a missing one", () => {
    // A line priced at $0 is a decision (an allowance absorbed elsewhere, a
    // no-charge item); a line with no price is a gap recovered elsewhere. Only
    // the second is a cost-only line.
    const result = bidMargin([
      line({ id: "free", quantity: 1, unitCost: 100, unitPrice: 0 }),
      line({ id: "priced", quantity: 1, unitCost: 1, unitPrice: 500 }),
    ]);
    expect(result.costOnlyLineCount).toBe(0);
  });

  it("does not count a zero-cost unpriced line as cost-only", () => {
    // Nothing to recover, so nothing to explain.
    const result = bidMargin([
      line({ id: "empty", quantity: 1, unitCost: 0, unitPrice: null }),
      line({ id: "priced", quantity: 1, unitCost: 1, unitPrice: 500 }),
    ]);
    expect(result.costOnlyLineCount).toBe(0);
  });

  it("reports the counts in EVERY state, not only the warning", () => {
    const covered = bidMargin([
      line({ id: "a", quantity: 1, unitCost: 1, unitPrice: 500 }),
      line({ id: "b", quantity: 1, unitCost: 0, unitPrice: 50 }),
    ]);
    expect(covered.pricedWithNoCostLineCount).toBe(1);
    const noPrices = bidMargin([line({ id: "a", quantity: 1, unitCost: 10, unitPrice: null })]);
    expect(noPrices.costOnlyLineCount).toBe(1);
  });
});

group("the warning sentence", () => {
  it("says nothing at all unless the bid is under cost", () => {
    for (const lines of [
      [line({ id: "a", quantity: 1, unitCost: 1, unitPrice: 2 })], // COVERED
      [line({ id: "a", quantity: 1, unitCost: 1, unitPrice: null })], // NO_PRICES
      [line({ id: "a", quantity: 1, unitCost: 0, unitPrice: 2 })], // NO_COSTS
      [], // empty
    ]) {
      expect(underCostWarning(bidMargin(lines), money)).toBeNull();
    }
  });

  it("names the money, not the percentage", () => {
    // "-3%" on a $400k bid is $12,000, and the dollars are what somebody acts
    // on. The percentage is on screen beside it; the sentence carries money.
    const result = bidMargin([line({ id: "a", quantity: 100, unitCost: 10, unitPrice: 9 })]);
    const sentence = underCostWarning(result, money)!;
    expect(sentence).toContain("$100.00");
    expect(sentence).not.toContain("%");
  });

  it("never tells the estimator what to do", () => {
    // Three answers are right — raise the prices, apply the recap, or send it
    // anyway on purpose to keep a crew together. The app does not know which,
    // and `lien-waiver.ts` is the rule: nothing here blocks and nothing here
    // reassures.
    const result = bidMargin([line({ id: "a", quantity: 100, unitCost: 10, unitPrice: 9 })]);
    const sentence = underCostWarning(result, money)!.toLowerCase();
    for (const forbidden of ["you should", "must ", "raise the price", "do not send", "fix this"]) {
      expect(sentence, forbidden).not.toContain(forbidden);
    }
  });
});

group("THE VACUITY PROOF: why this measures line prices and not the bid total", () => {
  /**
   * The obvious implementation is `(bidTotal − direct.total) / bidTotal`, and it
   * can NEVER be negative — so a warning built on it is unreachable code with a
   * sentence attached.
   *
   * This is pinned as a test rather than a comment because the "simplification"
   * is genuinely tempting: the recap already computes a total, and reusing it
   * would look like removing a duplicate. It would silently turn the warning
   * off. A comment does not fail a build.
   */
  const rates: RecapRates = {
    materialMarkupPercent: 15,
    laborMarkupPercent: 20,
    subcontractorMarkupPercent: 5,
    equipmentMarkupPercent: 10,
    otherMarkupPercent: 10,
    escalationPercent: 3,
    materialTaxPercent: 8,
    overheadPercent: 10,
    profitPercent: 10,
    bondPercent: 1.5,
    contingencyPercent: 2,
  };

  it("the recap's own bid total is never below its own direct cost", () => {
    const lines = [
      line({ id: "m", quantity: 100, unitCost: 20, unitPrice: 0, costCategory: "MATERIAL" }),
      line({ id: "l", quantity: 100, unitCost: 10, unitPrice: 0, costCategory: "LABOR" }),
    ];
    const recap = bidRecap(lines, rates);
    expect(recap.bidTotal).toBeGreaterThan(recap.direct.total);
    expect(recap.addedTotal).toBeGreaterThan(0);
  });

  it("stays non-negative even with EVERY rate blank, which is the only way to reach zero", () => {
    // `rate()` turns a missing percentage into 0, so the floor is the direct
    // cost itself — equal, never below.
    const blank = Object.fromEntries(Object.keys(rates).map((key) => [key, null])) as RecapRates;
    const lines = [line({ id: "m", quantity: 100, unitCost: 20, unitPrice: 0, costCategory: "MATERIAL" })];
    const recap = bidRecap(lines, blank);
    expect(recap.addedTotal).toBe(0);
    expect(recap.bidTotal).toBe(recap.direct.total);
    // So a margin taken from these two is 0% at worst and positive otherwise —
    // it cannot produce the UNDER_COST this module exists to report.
    expect(recap.bidTotal - recap.direct.total).toBeGreaterThanOrEqual(0);
  });

  it("while the LINE PRICES under the same recap are under cost — the case that matters", () => {
    // Identical lines, identical rates. The recap says $2,000 of cost becomes a
    // healthy bid; the prices actually on the lines say $900 against $1,000.
    // One of those is what the GC is asked to pay.
    const lines = [line({ id: "m", quantity: 100, unitCost: 10, unitPrice: 9, costCategory: "MATERIAL" })];
    const recap = bidRecap(lines, rates);
    expect(recap.bidTotal).toBeGreaterThan(recap.direct.total);
    expect(bidMargin(lines).state).toBe("UNDER_COST");
  });
});
