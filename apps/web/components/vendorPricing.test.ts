import { describe, expect, it } from "vitest";
import {
  type QuoteData,
  STALE_AFTER_DAYS,
  catalogGap,
  cheapestBadge,
  currentByUnit,
  currentQuote,
  daysBetween,
  isExpired,
  isStale,
  newestFirst,
  priceMovement,
  sourceLabel,
  unitKey,
  unitLabel,
} from "@/components/vendorPricing";

let seq = 0;
function quote(partial: Partial<QuoteData> = {}): QuoteData {
  seq += 1;
  return {
    id: `q${seq}`,
    vendorId: "v1",
    vendorName: "Acme Board",
    catalogEntryId: null,
    description: '5/8" Type X, 4x12',
    unit: "SF",
    unitPrice: 1.0,
    quotedOn: "2026-08-01",
    validUntil: null,
    source: "QUOTE",
    notes: null,
    ...partial,
  };
}

describe("newestFirst", () => {
  it("puts the newest quoted date first", () => {
    const older = quote({ quotedOn: "2026-06-01" });
    const newer = quote({ quotedOn: "2026-08-01" });
    expect(newestFirst([older, newer]).map((q) => q.id)).toEqual([newer.id, older.id]);
  });

  it("breaks a same-day tie on id, so the order is total and stable", () => {
    const a = quote({ id: "qa", quotedOn: "2026-08-01" });
    const b = quote({ id: "qb", quotedOn: "2026-08-01" });
    expect(newestFirst([a, b]).map((q) => q.id)).toEqual(["qb", "qa"]);
    expect(newestFirst([b, a]).map((q) => q.id)).toEqual(["qb", "qa"]);
  });

  it("does not mutate its input", () => {
    const quotes = [quote({ quotedOn: "2026-06-01" }), quote({ quotedOn: "2026-08-01" })];
    const before = quotes.map((q) => q.id);
    newestFirst(quotes);
    expect(quotes.map((q) => q.id)).toEqual(before);
  });
});

describe("isExpired", () => {
  it("is false with no vendor-stated expiry", () => {
    expect(isExpired(quote({ validUntil: null }), "2030-01-01")).toBe(false);
  });

  it("is still live ON the last day the vendor gave", () => {
    expect(isExpired(quote({ validUntil: "2026-08-30" }), "2026-08-30")).toBe(false);
  });

  it("is expired the day after", () => {
    expect(isExpired(quote({ validUntil: "2026-08-30" }), "2026-08-31")).toBe(true);
  });
});

describe("isStale", () => {
  it("flags an old quote the vendor put no expiry on", () => {
    expect(isStale(quote({ quotedOn: "2026-01-01", validUntil: null }), "2026-08-30")).toBe(true);
  });

  it("leaves a recent one alone", () => {
    expect(isStale(quote({ quotedOn: "2026-08-01", validUntil: null }), "2026-08-30")).toBe(false);
  });

  it("fires exactly on the boundary, not a day early", () => {
    const q = quote({ quotedOn: "2026-01-01", validUntil: null });
    const boundary = new Date(Date.parse("2026-01-01T00:00:00.000Z") + STALE_AFTER_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const dayBefore = new Date(Date.parse(`${boundary}T00:00:00.000Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(isStale(q, boundary)).toBe(true);
    expect(isStale(q, dayBefore)).toBe(false);
  });

  it("never second-guesses a vendor who gave an expiry, however old the quote", () => {
    // Their statement about their own price outranks our rule of thumb.
    // Once it lapses, isExpired is the truer answer anyway.
    const q = quote({ quotedOn: "2020-01-01", validUntil: "2030-01-01" });
    expect(isStale(q, "2026-08-30")).toBe(false);
  });
});

describe("currentQuote", () => {
  it("is the newest live quote", () => {
    const older = quote({ quotedOn: "2026-06-01", unitPrice: 0.9 });
    const newer = quote({ quotedOn: "2026-08-01", unitPrice: 1.1 });
    expect(currentQuote([older, newer], "2026-08-30")?.id).toBe(newer.id);
  });

  it("skips a newer quote the vendor has expired", () => {
    const live = quote({ quotedOn: "2026-06-01", validUntil: null });
    const lapsed = quote({ quotedOn: "2026-08-01", validUntil: "2026-08-10" });
    expect(currentQuote([live, lapsed], "2026-08-30")?.id).toBe(live.id);
  });

  it("is null when every quote has lapsed, rather than falling back to an expired one", () => {
    const lapsed = quote({ quotedOn: "2026-08-01", validUntil: "2026-08-10" });
    expect(currentQuote([lapsed], "2026-08-30")).toBeNull();
  });

  it("is null with no quotes at all", () => {
    expect(currentQuote([], "2026-08-30")).toBeNull();
  });
});

describe("unitKey", () => {
  it("treats case and padding as the same unit", () => {
    expect(unitKey(" sf ")).toBe(unitKey("SF"));
  });

  it("keeps MSF and SF apart", () => {
    expect(unitKey("MSF")).not.toBe(unitKey("SF"));
  });

  it("groups a missing unit with a blank one", () => {
    expect(unitKey(null)).toBe(unitKey("  "));
  });

  it("says so plainly when no unit was given", () => {
    expect(unitLabel(null)).toBe("no unit given");
    expect(unitLabel(" SF ")).toBe("SF");
  });
});

describe("priceMovement", () => {
  it("reports a rise between this vendor's last two prices", () => {
    const from = quote({ quotedOn: "2026-06-01", unitPrice: 1.0 });
    const to = quote({ quotedOn: "2026-08-01", unitPrice: 1.25 });
    const movement = priceMovement([from, to]);
    expect(movement?.changePercent).toBe(25);
    expect(movement?.to.id).toBe(to.id);
  });

  it("reports a fall as a negative", () => {
    const from = quote({ quotedOn: "2026-06-01", unitPrice: 2.0 });
    const to = quote({ quotedOn: "2026-08-01", unitPrice: 1.5 });
    expect(priceMovement([from, to])?.changePercent).toBe(-25);
  });

  it("does not call a difference between two vendors a movement", () => {
    const acme = quote({ vendorId: "v1", quotedOn: "2026-06-01", unitPrice: 1.0 });
    const other = quote({ vendorId: "v2", quotedOn: "2026-08-01", unitPrice: 1.5 });
    expect(priceMovement([acme, other])).toBeNull();
  });

  it("does not compare across units", () => {
    // 1000x apart because MSF and SF are a thousand apart. Reporting this
    // as a 99.9% price crash is the exact error unit-matching prevents.
    const perMsf = quote({ quotedOn: "2026-06-01", unit: "MSF", unitPrice: 1000 });
    const perSf = quote({ quotedOn: "2026-08-01", unit: "SF", unitPrice: 1 });
    expect(priceMovement([perMsf, perSf])).toBeNull();
  });

  it("still matches when only the unit's spelling differs", () => {
    const from = quote({ quotedOn: "2026-06-01", unit: "sf", unitPrice: 1.0 });
    const to = quote({ quotedOn: "2026-08-01", unit: " SF", unitPrice: 1.1 });
    expect(priceMovement([from, to])?.changePercent).toBe(10);
  });

  it("counts an expired quote as history, so a rise off it is not hidden", () => {
    const lapsed = quote({ quotedOn: "2026-06-01", unitPrice: 1.0, validUntil: "2026-06-30" });
    const now = quote({ quotedOn: "2026-08-01", unitPrice: 1.4 });
    expect(priceMovement([lapsed, now])?.changePercent).toBe(40);
  });

  it("is null on a single quote", () => {
    expect(priceMovement([quote()])).toBeNull();
  });

  it("refuses a percentage off a zero base", () => {
    const from = quote({ quotedOn: "2026-06-01", unitPrice: 0 });
    const to = quote({ quotedOn: "2026-08-01", unitPrice: 1 });
    expect(priceMovement([from, to])).toBeNull();
  });
});

describe("currentByUnit", () => {
  it("finds the cheapest live price and the spread", () => {
    const acme = quote({ vendorId: "v1", vendorName: "Acme", unitPrice: 1.0 });
    const bolt = quote({ vendorId: "v2", vendorName: "Bolt", unitPrice: 1.5 });
    const [comparison] = currentByUnit([acme, bolt], "2026-08-30");
    expect(comparison.cheapest.vendorName).toBe("Acme");
    expect(comparison.dearest.vendorName).toBe("Bolt");
    expect(comparison.spreadPercent).toBe(50);
  });

  it("never lets one vendor appear twice — only their newest live price competes", () => {
    const old = quote({ vendorId: "v1", vendorName: "Acme", quotedOn: "2026-06-01", unitPrice: 0.5 });
    const now = quote({ vendorId: "v1", vendorName: "Acme", quotedOn: "2026-08-01", unitPrice: 1.2 });
    const bolt = quote({ vendorId: "v2", vendorName: "Bolt", quotedOn: "2026-08-01", unitPrice: 1.0 });
    const [comparison] = currentByUnit([old, now, bolt], "2026-08-30");
    expect(comparison.quotes).toHaveLength(2);
    // The superseded 0.50 must not win: it is not on offer any more.
    expect(comparison.cheapest.vendorName).toBe("Bolt");
  });

  it("puts different units in different buckets rather than comparing them", () => {
    const perSf = quote({ vendorId: "v1", unit: "SF", unitPrice: 1 });
    const perMsf = quote({ vendorId: "v2", unit: "MSF", unitPrice: 1000 });
    const comparisons = currentByUnit([perSf, perMsf], "2026-08-30");
    expect(comparisons).toHaveLength(2);
    for (const comparison of comparisons) {
      expect(comparison.quotes).toHaveLength(1);
    }
  });

  it("has no spread when only one vendor answered", () => {
    // 0% would read as "everyone agrees" when the truth is "one quote".
    expect(currentByUnit([quote()], "2026-08-30")[0].spreadPercent).toBeNull();
  });

  it("drops expired quotes out of the comparison entirely", () => {
    const lapsed = quote({ vendorId: "v1", vendorName: "Acme", unitPrice: 0.5, validUntil: "2026-08-01" });
    const live = quote({ vendorId: "v2", vendorName: "Bolt", unitPrice: 1.5 });
    const comparisons = currentByUnit([lapsed, live], "2026-08-30");
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0].cheapest.vendorName).toBe("Bolt");
  });

  it("is empty when nothing is live", () => {
    const lapsed = quote({ validUntil: "2026-08-01" });
    expect(currentByUnit([lapsed], "2026-08-30")).toEqual([]);
  });
});

describe("catalogGap", () => {
  const comparisons = (unitPrice: number, unit: string | null = "SF") =>
    currentByUnit([quote({ unit, unitPrice })], "2026-08-30");

  it("flags a catalog default nobody will actually sell at", () => {
    const gap = catalogGap(0.8, "SF", comparisons(1.0));
    expect(gap?.shortfallPercent).toBe(20);
    expect(gap?.cheapest.unitPrice).toBe(1.0);
  });

  it("says nothing when the catalog is at or above the cheapest quote", () => {
    expect(catalogGap(1.0, "SF", comparisons(1.0))).toBeNull();
    expect(catalogGap(1.5, "SF", comparisons(1.0))).toBeNull();
  });

  it("refuses to compare a catalog price against a quote in another unit", () => {
    // The catalog is per SF, the only live quote is per MSF. A "gap" here
    // would be arithmetic on unrelated numbers, shown as a warning.
    expect(catalogGap(0.8, "SF", comparisons(1000, "MSF"))).toBeNull();
  });

  it("matches units regardless of spelling", () => {
    expect(catalogGap(0.8, " sf ", comparisons(1.0, "SF"))?.shortfallPercent).toBe(20);
  });

  it("says nothing without a catalog cost to compare", () => {
    expect(catalogGap(null, "SF", comparisons(1.0))).toBeNull();
    expect(catalogGap(0, "SF", comparisons(1.0))).toBeNull();
  });

  it("says nothing when no quote is live", () => {
    expect(catalogGap(0.8, "SF", [])).toBeNull();
  });
});

describe("daysBetween", () => {
  it("counts whole days across a month boundary", () => {
    expect(daysBetween("2026-08-30", "2026-09-01")).toBe(2);
  });

  it("is unaffected by daylight saving, being pinned to UTC midnight", () => {
    // US DST ends 1 Nov 2026; a naive local-time subtraction gives 30.04.
    expect(daysBetween("2026-10-15", "2026-11-14")).toBe(30);
  });
});

describe("cheapestBadge", () => {
  it("names the unit it is cheapest in", () => {
    // Found by clicking: an item quoted per SF by two vendors and per MSF
    // by one renders a "cheapest" badge in EACH bucket. Both are true, and
    // two bare "cheapest live" badges on one item read as a contradiction.
    expect(cheapestBadge("SF")).toBe("cheapest per SF");
    expect(cheapestBadge("MSF")).toBe("cheapest per MSF");
    expect(cheapestBadge("SF")).not.toBe(cheapestBadge("MSF"));
  });

  it("trims the vendor's spacing without changing their wording", () => {
    expect(cheapestBadge(" sf ")).toBe("cheapest per sf");
  });

  it("falls back to the bare wording when there is no unit to name", () => {
    expect(cheapestBadge(null)).toBe("cheapest live");
    expect(cheapestBadge("  ")).toBe("cheapest live");
  });
});

describe("sourceLabel", () => {
  it("names each source in a person's words", () => {
    expect(sourceLabel("QUOTE")).toBe("Written quote");
    expect(sourceLabel("INVOICE")).toBe("Off an invoice");
    expect(sourceLabel("PRICE_LIST")).toBe("Price list");
    expect(sourceLabel("VERBAL")).toBe("Told verbally");
  });

  it("shows an unknown source rather than swallowing it", () => {
    expect(sourceLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});
