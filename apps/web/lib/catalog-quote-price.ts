/**
 * Setting a catalog entry's default COST from what a vendor will actually sell
 * it for today.
 *
 * `/vendors/pricing` has warned for a while that "your catalog default is N%
 * under what anyone will actually sell this at", and then said, correctly, that
 * nothing had been changed because "updating the catalog is a decision about
 * your own pricing, and it belongs on the catalog". This is the half that link
 * points at.
 *
 * IT READS THE VENDORS LANE AND WRITES NOTHING THERE. Every notion of current,
 * expired, cheapest and same-unit comes from `components/vendorPricing.ts` —
 * imported, never re-implemented, so the figure behind this button is the same
 * figure the vendors page shows. Two implementations of "the cheapest live
 * quote" is how a button comes to disagree with the badge above it.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE ACTUALS LOOP NEXT DOOR. `catalog-actuals.ts`
 * needs CATALOG_MIN_SAMPLE finished jobs before it will offer to re-price,
 * because one job that went badly is an anecdote. A quote is not an anecdote:
 * one written quote IS the price that vendor will sell at today, so there is no
 * sample gate here. What there is instead is the SOURCE — a price told to
 * somebody over the counter is not the same evidence as a written quote, so the
 * source travels with the decision and is shown on the button.
 *
 * Pure. No database, no Prisma: the number a bid will be built from can be
 * checked without one.
 */

import {
  currentByUnit,
  unitKey,
  unitLabel,
  sourceLabel,
  type QuoteData,
} from "@/components/vendorPricing";

export type QuotePriceEntry = {
  /** The entry's own unit — free text, nullable, never converted. */
  unit: string | null;
  defaultBudgetedUnitCost: number | null;
  defaultUnitPrice: number | null;
};

/** What the screen shows and the button would write, or why there is nothing
 * to offer. One shape for both, so the badge and the button cannot disagree. */
export type QuotePriceOffer = {
  vendorName: string;
  /** The quote's price per unit — what the default cost would become. */
  unitPrice: number;
  quotedOn: string;
  source: string;
  sourceLabel: string;
  unit: string | null;
  /** The stored default today, for the sentence beside the button. */
  currentCost: number | null;
  /** True when the entry has no unit and the quote has none either. Allowed,
   * but said out loud — a silent match on "no unit" is how a price per MSF
   * quietly becomes a price per SF. */
  unitless: boolean;
};

export type QuotePriceDecision =
  | { ok: false; error: string }
  | {
      ok: true;
      offer: QuotePriceOffer;
      /** Ready for a Decimal column. */
      defaultBudgetedUnitCost: string;
      /** Present only when the caller asked to move the price too AND there
       * was a margin to hold. */
      defaultUnitPrice?: string;
    };

/**
 * The cheapest live quote in the entry's OWN unit, or null.
 *
 * `currentByUnit` has already done the hard parts: expired quotes dropped, one
 * quote per vendor (their newest live one), buckets keyed by a normalised unit
 * that is never converted between. All this adds is picking the bucket that
 * matches the catalog entry — which is the step where the MSF-versus-SF error
 * would live if anybody took a shortcut.
 */
export function cheapestQuoteForEntry(
  entry: QuotePriceEntry,
  quotes: QuoteData[],
  today: string,
): QuoteData | null {
  const match = currentByUnit(quotes, today).find(
    (comparison) => unitKey(comparison.unit) === unitKey(entry.unit),
  );
  return match?.cheapest ?? null;
}

/** The units that DO have a live quote, for the refusal sentence — a reader
 * told "no quote in SF" wants to know that there are three in MSF. */
function liveUnits(quotes: QuoteData[], today: string): string[] {
  return currentByUnit(quotes, today).map((comparison) => unitLabel(comparison.unit));
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * What pressing the button would do, or the sentence explaining why it is not
 * offered.
 *
 * THE SIGNATURE IS THE GUARD, exactly as `repriceDecision`'s is: there is
 * nowhere here for a number the browser sent to come in. The only thing the
 * request decides is the margin checkbox, which is a pricing judgement that
 * belongs to the estimator rather than a fact the quotes establish.
 */
export function quotePriceDecision(
  entry: QuotePriceEntry,
  quotes: QuoteData[],
  today: string,
  alsoUpdatePrice: boolean,
): QuotePriceDecision {
  if (quotes.length === 0) {
    return {
      ok: false,
      error:
        "No vendor has quoted this item yet. Record what a supplier said it costs on Vendors → Pricing, and this will offer to use it.",
    };
  }

  const cheapest = cheapestQuoteForEntry(entry, quotes, today);
  if (!cheapest) {
    const units = liveUnits(quotes, today);
    if (units.length === 0) {
      return {
        ok: false,
        error:
          "Every quote on this item has expired. Record a current one on Vendors → Pricing — an expired price is not what anyone will sell at today.",
      };
    }
    // Never a cross-unit comparison: a price per MSF is a thousand times a
    // price per SF, and guessing the factor invents a number that looks right.
    return {
      ok: false,
      error: `No live quote is priced by ${unitLabel(entry.unit)}, which is how this catalog item is measured. There ${
        units.length === 1 ? "is one" : `are ${units.length}`
      } in ${units.join(", ")} — prices are never converted between units, so record a quote in ${unitLabel(
        entry.unit,
      )} to use one here.`,
    };
  }

  const current = entry.defaultBudgetedUnitCost;
  const next = round2(cheapest.unitPrice);
  if (current != null && round2(current) === next) {
    return {
      ok: false,
      error: "This item's default cost already matches the cheapest live quote, so there is nothing to change.",
    };
  }

  const offer: QuotePriceOffer = {
    vendorName: cheapest.vendorName,
    unitPrice: next,
    quotedOn: cheapest.quotedOn,
    source: cheapest.source,
    sourceLabel: sourceLabel(cheapest.source),
    unit: cheapest.unit,
    currentCost: current,
    unitless: unitKey(entry.unit) === "",
  };

  const defaultBudgetedUnitCost = next.toFixed(2);
  if (!alsoUpdatePrice) return { ok: true, offer, defaultBudgetedUnitCost };

  // Hold the existing margin over the new cost, so the price moves by the same
  // proportion rather than collapsing to cost. With no prior price or no prior
  // cost there is no margin to preserve, and inventing one is a pricing
  // decision this has no business making — the cost still moves and the price
  // is left alone. The same rule, and the same backstop, as repriceDecision.
  if (current == null || current <= 0 || entry.defaultUnitPrice == null) {
    return { ok: true, offer, defaultBudgetedUnitCost };
  }
  return {
    ok: true,
    offer,
    defaultBudgetedUnitCost,
    defaultUnitPrice: ((entry.defaultUnitPrice / current) * next).toFixed(2),
  };
}
