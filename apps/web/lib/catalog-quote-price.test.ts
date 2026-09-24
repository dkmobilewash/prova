import { describe, expect, it } from "vitest";
import { cheapestQuoteForEntry, quotePriceDecision, type QuotePriceEntry } from "./catalog-quote-price";
import type { QuoteData } from "@/components/vendorPricing";

const TODAY = "2026-09-22";

const quote = (over: Partial<QuoteData> & Pick<QuoteData, "id" | "unitPrice">): QuoteData => ({
  vendorId: `v_${over.id}`,
  vendorName: `Vendor ${over.id}`,
  catalogEntryId: "cat_1",
  description: "5/8 Type X",
  unit: "SF",
  quotedOn: "2026-09-12",
  validUntil: null,
  source: "QUOTE",
  notes: null,
  ...over,
});

const entry = (over: Partial<QuotePriceEntry> = {}): QuotePriceEntry => ({
  unit: "SF",
  defaultBudgetedUnitCost: 1.5,
  defaultUnitPrice: 3,
  ...over,
});

describe("finding the quote to price from", () => {
  it("takes the cheapest live quote in the entry's own unit", () => {
    const found = cheapestQuoteForEntry(
      entry(),
      [quote({ id: "a", unitPrice: 2.1 }), quote({ id: "b", unitPrice: 1.9 }), quote({ id: "c", unitPrice: 2.4 })],
      TODAY,
    );
    expect(found?.id).toBe("b");
  });

  it("never takes an expired quote, however cheap", () => {
    const found = cheapestQuoteForEntry(
      entry(),
      [quote({ id: "cheap", unitPrice: 0.5, validUntil: "2026-09-01" }), quote({ id: "live", unitPrice: 1.9 })],
      TODAY,
    );
    expect(found?.id).toBe("live");
  });

  it("NEVER matches a different unit — a price per MSF is not a price per SF", () => {
    // 1000 SF of board quoted at $1,900 per MSF is $1.90 a foot. Taking it as
    // $1,900 a foot is the thousand-fold error this rule exists to prevent.
    const found = cheapestQuoteForEntry(entry({ unit: "SF" }), [quote({ id: "msf", unitPrice: 1900, unit: "MSF" })], TODAY);
    expect(found).toBeNull();
  });

  it("matches a unit written differently — 'sf', ' SF ' and 'SF' are one unit", () => {
    const found = cheapestQuoteForEntry(entry({ unit: " sf " }), [quote({ id: "a", unitPrice: 1.9, unit: "SF" })], TODAY);
    expect(found?.id).toBe("a");
  });
});

describe("the decision", () => {
  it("offers the cheapest live quote as the new default cost", () => {
    const decision = quotePriceDecision(entry(), [quote({ id: "a", unitPrice: 1.9 })], TODAY, false);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.defaultBudgetedUnitCost).toBe("1.90");
    expect(decision.offer).toMatchObject({
      vendorName: "Vendor a",
      unitPrice: 1.9,
      currentCost: 1.5,
      sourceLabel: "Written quote",
      unitless: false,
    });
    // The sale price does not move unless it is asked for.
    expect(decision.defaultUnitPrice).toBeUndefined();
  });

  it("holds the margin when asked to move the price too", () => {
    // Cost 1.50 sold at 3.00 is a 2x margin; at a cost of 1.90 that is 3.80.
    const decision = quotePriceDecision(entry(), [quote({ id: "a", unitPrice: 1.9 })], TODAY, true);
    expect(decision.ok && decision.defaultUnitPrice).toBe("3.80");
  });

  it("moves the cost but not the price when there is no margin to hold", () => {
    const noPrice = quotePriceDecision(entry({ defaultUnitPrice: null }), [quote({ id: "a", unitPrice: 1.9 })], TODAY, true);
    expect(noPrice.ok && noPrice.defaultUnitPrice).toBeUndefined();
    const noCost = quotePriceDecision(entry({ defaultBudgetedUnitCost: null }), [quote({ id: "a", unitPrice: 1.9 })], TODAY, true);
    expect(noCost.ok && noCost.defaultUnitPrice).toBeUndefined();
    expect(noCost.ok && noCost.defaultBudgetedUnitCost).toBe("1.90");
  });

  it("says so plainly when nobody has quoted the item", () => {
    const decision = quotePriceDecision(entry(), [], TODAY, false);
    expect(decision).toMatchObject({ ok: false });
    expect(!decision.ok && decision.error).toMatch(/No vendor has quoted this item yet/);
  });

  it("distinguishes 'all expired' from 'none recorded'", () => {
    const decision = quotePriceDecision(entry(), [quote({ id: "old", unitPrice: 1.9, validUntil: "2026-09-01" })], TODAY, false);
    expect(!decision.ok && decision.error).toMatch(/Every quote on this item has expired/);
  });

  it("names the units it DOES have when none matches the entry's", () => {
    const decision = quotePriceDecision(
      entry({ unit: "SF" }),
      [quote({ id: "m", unitPrice: 1900, unit: "MSF" }), quote({ id: "e", unitPrice: 12, unit: "EA" })],
      TODAY,
      false,
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.error).toContain("No live quote is priced by SF");
    expect(decision.error).toContain("MSF");
    expect(decision.error).toContain("EA");
    expect(decision.error).toMatch(/never converted between units/);
  });

  it("refuses when the default already equals the cheapest live quote", () => {
    const decision = quotePriceDecision(entry({ defaultBudgetedUnitCost: 1.9 }), [quote({ id: "a", unitPrice: 1.9 })], TODAY, false);
    expect(!decision.ok && decision.error).toMatch(/already matches the cheapest live quote/);
  });

  it("offers a dearer quote too — the catalog should be right, not optimistic", () => {
    // The vendors page only warns when the catalog is UNDER the market. Here
    // the stored cost is 2.50 and the real price is 1.90, which is equally
    // worth fixing in the other direction.
    const decision = quotePriceDecision(entry({ defaultBudgetedUnitCost: 2.5 }), [quote({ id: "a", unitPrice: 1.9 })], TODAY, false);
    expect(decision.ok && decision.defaultBudgetedUnitCost).toBe("1.90");
  });

  it("matches a unitless entry to a unitless quote, and SAYS it is unitless", () => {
    const decision = quotePriceDecision(entry({ unit: null }), [quote({ id: "a", unitPrice: 40, unit: null })], TODAY, false);
    expect(decision.ok).toBe(true);
    expect(decision.ok && decision.offer.unitless).toBe(true);
  });

  it("carries the source, because a verbal price is not a written one", () => {
    const decision = quotePriceDecision(entry(), [quote({ id: "a", unitPrice: 1.9, source: "VERBAL" })], TODAY, false);
    expect(decision.ok && decision.offer.sourceLabel).toBe("Told verbally");
  });
});
