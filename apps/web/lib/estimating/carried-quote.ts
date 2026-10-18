/**
 * WHAT CARRYING A QUOTE MEANS, AND WHAT IT WOULD PUT ON A LINE.
 *
 * ── THE DECISION THIS RECORDS, AND THE ONE IT REFUSES TO MAKE ──
 *
 * `bid-levelling.ts` will not name a winner, and that is the whole feature:
 * *"THE POINT OF LEVELLING IS NOT 'WHO IS CHEAPEST'. IT IS 'ARE THEY EVEN
 * BIDDING THE SAME THING'."* It has no scoring, no weighting and no adjusted
 * price that adds the excluded work back onto the low bid. "Cheapest" is an
 * artefact of a sort, recomputed on every render and never stored, because it
 * is not an answer.
 *
 * None of that changes. What changes is that the ESTIMATOR'S answer — read the
 * exclusions, decide who is comparable, pick the price you are carrying — had
 * nowhere to live, so it was retyped into a line item from memory or not
 * carried across at all. `BidQuote.carriedAt` is that answer. Nothing infers
 * it, nothing defaults to the low bid, and marking a quote carried is not a
 * claim that it was the best one.
 *
 * ── A CARRIED QUOTE IS AN ASSUMPTION; A LINE ITEM COST IS A COMMITMENT ──
 *
 * So the two are separate acts. Recording what you carried is free, costs
 * nothing if the bid is lost, and is worth having either way — "we carried
 * Alpha at $48,000 and lost at $512,000" is the only way to learn anything
 * afterwards. Putting that money on a line is a second, explicit press, and it
 * needs a job to put it on.
 *
 * ── AND IT IS A LUMP SUM, WHICH IS WHY THE LINE IS SHAPED THE WAY IT IS ──
 *
 * `BidQuote.amount` has no unit and no quantity — it is what one sub said one
 * package costs. `JobLineItem` prices per unit and multiplies by quantity, so
 * the honest mapping is quantity 1 at the lump sum, coded SUBCONTRACTOR. Any
 * attempt to spread it across units would be inventing a breakdown the sub did
 * not give, and `catalog-quote-price.ts` already states the rule for the
 * neighbouring case: prices are never converted between units, because guessing
 * the factor invents a number that looks right.
 *
 * PURE. No database, no React, no clock.
 */

/** As much of a quote as this decision needs. */
export type CarriedQuoteInput = {
  id: string;
  vendorName: string;
  packageLabel: string;
  /** Null means they never answered — see `isAnswered`. */
  amount: number | null;
  declinedAt: Date | null;
  carriedAt: Date | null;
};

export type CarryDecision = { ok: false; error: string } | { ok: true };

/**
 * Whether this quote can be marked as the one we carried.
 *
 * The refusals are the ones that would otherwise produce a meaningless record:
 * you cannot carry a price nobody gave, and you cannot carry a sub who said no.
 * Both are recoverable states rather than errors — the sentence says how.
 */
export function carryDecision(quote: CarriedQuoteInput): CarryDecision {
  if (quote.declinedAt !== null) {
    return {
      ok: false,
      error: `${quote.vendorName} declined to bid this package, so there is no price of theirs to carry.`,
    };
  }
  if (quote.amount === null) {
    return {
      ok: false,
      error: `${quote.vendorName} hasn't given a price yet. Enter what they quoted and then mark it carried.`,
    };
  }
  return { ok: true };
}

export type CarriedLinePlan =
  | { ok: false; error: string }
  | { ok: true; description: string; unitCost: number };

/**
 * What pressing "use this on the estimate" would write, or why it is not
 * offered.
 *
 * THE SIGNATURE IS THE GUARD, the rule `catalog-quote-price.ts` states:
 * there is nowhere here for a number the browser sent to come in. The caller
 * names a quote; the amount is read from the stored row.
 *
 * The description names the vendor and the package, because a `$48,000`
 * subcontractor line that says only "Subcontract" is one nobody can check
 * against the quote it came from six weeks later.
 */
export function carriedLinePlan(quote: CarriedQuoteInput): CarriedLinePlan {
  const carryable = carryDecision(quote);
  if (!carryable.ok) return carryable;
  if (quote.carriedAt === null) {
    return {
      ok: false,
      error: "Mark a quote as the one you carried first — this puts that price on the estimate, not any price.",
    };
  }
  // `amount` is non-null here: `carryDecision` refused otherwise.
  const amount = quote.amount as number;
  if (amount <= 0) {
    return {
      ok: false,
      error: "That quote is zero, so there is no cost to put on the estimate.",
    };
  }
  return {
    ok: true,
    description: `${quote.packageLabel} — ${quote.vendorName}`,
    unitCost: amount,
  };
}

/**
 * The carried quote in a package, if one is marked.
 *
 * ONE PER PACKAGE is enforced where the write happens rather than by a
 * constraint — a partial unique index over `packageLabel` where `carriedAt` is
 * non-null is not expressible in this schema, and two carried quotes on one
 * scope is a contradiction rather than a race. This reader takes the FIRST and
 * does not try to adjudicate, for the reason `missingIndirects` gives about
 * duplicate catalog entries: picking between them would invent a rule nobody
 * asked for.
 */
export function carriedIn<T extends { carriedAt: Date | null }>(quotes: readonly T[]): T | null {
  return quotes.find((quote) => quote.carriedAt !== null) ?? null;
}
