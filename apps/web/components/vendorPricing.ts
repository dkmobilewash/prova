/** What vendor quotes mean, so the page, the row and the comparison block
 * can't disagree about which price is current or which is cheapest.
 *
 * Nothing here is stored. "Current", "expired", "stale", "cheapest" and
 * every movement figure are derived from the quotes on every read — the
 * same rule as the delivery log, the overdue RFI and the current drawing
 * revision. A stored "current price" is wrong the moment a newer quote is
 * entered, and this is data people bid off.
 *
 * NOTHING IN HERE MAY EVER BE SUMMED INTO A JOB. A quote is what a vendor
 * said a thing costs on a date; actual job cost lives on `CostEntry`
 * against a `JobLineItem`, and a second path to a job's money is the
 * anti-pattern ARCHITECTURE.md exists to prevent.
 */

export type QuoteData = {
  id: string;
  vendorId: string;
  vendorName: string;
  catalogEntryId: string | null;
  description: string;
  unit: string | null;
  /** Already converted from Decimal by the caller. Compared and displayed,
   * never accumulated into billable money — see the header. */
  unitPrice: number;
  /** "YYYY-MM-DD", UTC midnight, entered not stamped. */
  quotedOn: string;
  validUntil: string | null;
  source: string;
  notes: string | null;
};

/** Newest first. Ties on the quoted date break on id so the order is total
 * and stable: several quotes genuinely arrive on one day, and an unstable
 * sort would let "the current price" flicker between two numbers on
 * consecutive renders of the same data. */
export function newestFirst(quotes: QuoteData[]): QuoteData[] {
  return [...quotes].sort((a, b) => {
    if (a.quotedOn !== b.quotedOn) return a.quotedOn < b.quotedOn ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

/** Past the date the vendor themselves put on it.
 *
 * Inclusive of the last day: a price held "until the 30th" is still good
 * ON the 30th. Off-by-one here would tell someone a live price is dead on
 * the one day they most need it. */
export function isExpired(quote: QuoteData, today: string): boolean {
  return quote.validUntil !== null && quote.validUntil < today;
}

/** How long an un-expiring quote stays believable.
 *
 * A guess, and deliberately a conservative one: it changes what is
 * FLAGGED, never what is stored or hidden. A stale quote is still shown
 * and still comparable — the flag says "ring them before you bid this",
 * which is the only honest thing a date can tell you. */
export const STALE_AFTER_DAYS = 90;

/** Whole days between two UTC-midnight ISO dates. */
export function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

/** Old enough to be worth re-checking, on our judgement rather than the
 * vendor's.
 *
 * Only ever applies when the vendor gave no expiry. If they said the price
 * holds until a date, that is THEIR statement about their own price and it
 * outranks our rule of thumb until it lapses — at which point `isExpired`
 * is the truer answer anyway. Applying both would flag one quote two
 * different ways for the same reason. */
export function isStale(quote: QuoteData, today: string, afterDays = STALE_AFTER_DAYS): boolean {
  if (quote.validUntil !== null) return false;
  return daysBetween(quote.quotedOn, today) >= afterDays;
}

/** The price you'd quote off today: the newest one the vendor hasn't
 * expired. Null when every quote for the item has lapsed — which is a real
 * answer ("nobody has a live price on this") and must not be faked by
 * falling back to the newest expired one. */
export function currentQuote(quotes: QuoteData[], today: string): QuoteData | null {
  return newestFirst(quotes).find((quote) => !isExpired(quote, today)) ?? null;
}

/** Units compared case- and space-insensitively, and never converted.
 *
 * "SF", "sf" and " SF " are one unit and must compare; MSF and SF are not,
 * and the factor between them is the vendor's business, not ours. Guessing
 * it would turn a thousand-square-foot price into a square-foot price and
 * declare a vendor 1000x cheaper. Unitless quotes group together as their
 * own bucket rather than joining any named one. */
export function unitKey(unit: string | null): string {
  return (unit ?? "").trim().toUpperCase();
}

export function unitLabel(unit: string | null): string {
  const trimmed = (unit ?? "").trim();
  return trimmed === "" ? "no unit given" : trimmed;
}

export type PriceMovement = {
  from: QuoteData;
  to: QuoteData;
  /** Positive is a rise. Rounded to one decimal — more precision than the
   * underlying prices support would be false confidence. */
  changePercent: number;
};

/** How this vendor's price for this item moved, newest against the one
 * before it.
 *
 * Same vendor, same unit only. A "movement" measured across two vendors is
 * not a movement, it is a difference of opinion; measured across units it
 * is arithmetic on unrelated numbers. Both would show as a price swing
 * that never happened, on a screen people bid from.
 *
 * Expired quotes still count as history — a price that lapsed is still
 * where the price WAS, and dropping it would hide exactly the rise this is
 * meant to surface. */
export function priceMovement(quotes: QuoteData[]): PriceMovement | null {
  const ordered = newestFirst(quotes);
  const to = ordered[0];
  if (!to) return null;

  const from = ordered
    .slice(1)
    .find((quote) => quote.vendorId === to.vendorId && unitKey(quote.unit) === unitKey(to.unit));
  if (!from) return null;
  if (from.unitPrice === 0) return null; // no percentage off a zero base

  const changePercent = ((to.unitPrice - from.unitPrice) / from.unitPrice) * 100;
  return { from, to, changePercent: Math.round(changePercent * 10) / 10 };
}

export type UnitComparison = {
  unit: string | null;
  /** One current quote per vendor, cheapest first. */
  quotes: QuoteData[];
  cheapest: QuoteData;
  dearest: QuoteData;
  /** How much more the dearest is than the cheapest, as a whole percent.
   * Null when only one vendor has a live price — there is no spread
   * between a number and itself, and rendering 0% would read as "everyone
   * agrees" when the truth is "only one person answered". */
  spreadPercent: number | null;
};

/** The current price from each vendor, grouped into buckets that can
 * honestly be compared.
 *
 * One bucket per unit, because that is the only boundary within which
 * "cheapest" means anything. Only the newest live quote per vendor is
 * compared: a vendor's own superseded price is not a competing offer, and
 * counting it would let one vendor appear twice in a comparison of three.
 */
export function currentByUnit(quotes: QuoteData[], today: string): UnitComparison[] {
  const live = newestFirst(quotes).filter((quote) => !isExpired(quote, today));

  const buckets = new Map<string, { unit: string | null; byVendor: Map<string, QuoteData> }>();
  for (const quote of live) {
    const key = unitKey(quote.unit);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { unit: quote.unit, byVendor: new Map() };
      buckets.set(key, bucket);
    }
    // `live` is newest-first, so the first quote seen for a vendor is that
    // vendor's current one and later ones are superseded.
    if (!bucket.byVendor.has(quote.vendorId)) {
      bucket.byVendor.set(quote.vendorId, quote);
    }
  }

  return [...buckets.values()]
    .map(({ unit, byVendor }) => {
      const sorted = [...byVendor.values()].sort((a, b) => {
        if (a.unitPrice !== b.unitPrice) return a.unitPrice - b.unitPrice;
        return a.vendorName.localeCompare(b.vendorName);
      });
      const cheapest = sorted[0];
      const dearest = sorted[sorted.length - 1];
      const spreadPercent =
        sorted.length < 2 || cheapest.unitPrice === 0
          ? null
          : Math.round(((dearest.unitPrice - cheapest.unitPrice) / cheapest.unitPrice) * 100);
      return { unit, quotes: sorted, cheapest, dearest, spreadPercent };
    })
    .sort((a, b) => b.quotes.length - a.quotes.length || unitKey(a.unit).localeCompare(unitKey(b.unit)));
}

export type CatalogGap = {
  catalogCost: number;
  cheapest: QuoteData;
  /** How far under the cheapest live quote the catalog default sits, as a
   * whole percent of that quote. */
  shortfallPercent: number;
};

/** The estimating payoff: your catalog default is below what anyone will
 * actually sell you for.
 *
 * Bidding off a stale template is how a job is lost before it starts, and
 * the catalog has no way to know a price moved — nothing writes back into
 * it. This compares the template's cost against the cheapest LIVE quote in
 * the SAME unit and says so when the template is under it.
 *
 * Returns null rather than a zero when there is nothing to say: no catalog
 * cost, no live quote, or no quote in the catalog's own unit. A comparison
 * across units would be the MSF-versus-SF error dressed up as a warning,
 * and a warning that is sometimes nonsense is one people learn to ignore.
 */
export function catalogGap(
  catalogCost: number | null,
  catalogUnit: string | null,
  comparisons: UnitComparison[],
): CatalogGap | null {
  if (catalogCost === null || catalogCost <= 0) return null;

  const match = comparisons.find((comparison) => unitKey(comparison.unit) === unitKey(catalogUnit));
  if (!match) return null;

  const cheapest = match.cheapest;
  if (cheapest.unitPrice <= catalogCost) return null;

  return {
    catalogCost,
    cheapest,
    shortfallPercent: Math.round(((cheapest.unitPrice - catalogCost) / cheapest.unitPrice) * 100),
  };
}

/** The "cheapest" badge, which must name the unit it is cheapest IN.
 *
 * Found by clicking, not by a test: an item quoted per SF by two vendors
 * and per MSF by one renders three rows, and a bare "cheapest live" on the
 * SF winner AND on the lone MSF quote reads as two contradictory claims
 * about the same item. Both were true — each is cheapest in its own unit —
 * but a badge that has to be reconciled against a heading is a badge that
 * gets misread, and misread here means bidding off the wrong number.
 *
 * Falls back to the bare wording only when there is no unit to name. */
export function cheapestBadge(unit: string | null): string {
  const trimmed = (unit ?? "").trim();
  return trimmed === "" ? "cheapest live" : `cheapest per ${trimmed}`;
}

export function sourceLabel(source: string): string {
  switch (source) {
    case "QUOTE":
      return "Written quote";
    case "INVOICE":
      return "Off an invoice";
    case "PRICE_LIST":
      return "Price list";
    case "VERBAL":
      return "Told verbally";
    default:
      return source;
  }
}

/** Why a source matters to whoever is reading the number. Shown rather
 * than ranked: an invoice is what was really charged, a phone price is
 * what someone remembers, and which of those you trust is a judgement for
 * the person bidding, not for this file. */
export function sourceNote(source: string): string | null {
  switch (source) {
    case "INVOICE":
      return "what was actually charged";
    case "VERBAL":
      return "nothing in writing";
    case "PRICE_LIST":
      return "published list, not quoted for a job";
    default:
      return null;
  }
}
