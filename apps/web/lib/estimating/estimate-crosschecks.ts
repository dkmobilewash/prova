/**
 * A QUANTITY THAT EXISTS IN ONE PLACE AND NO LINE FOR IT IN ANOTHER.
 *
 * ── THE SHAPE, AND WHY NOTHING HERE HAD IT ──
 *
 * The audit's own example is *"you measured 50 doors, but have 0 hardware sets
 * priced"*. Twelve advisory checks already run on an estimate and not one of
 * them is that shape. Every one reads a SINGLE ROW — a line with a price and no
 * cost, an alternate with no amount, a run with no height — or a FIXED LIST
 * (`missingIndirects`, eight enum members with no triggering quantity). Those
 * catch a field somebody left blank. They cannot catch work that was measured,
 * or a price that was decided, and then never reached the number sent to a GC.
 *
 * The one place in the repo that already does this is `lien-waiver.ts`'s
 * `exceptions-short`: job retainage plus submitted change orders are
 * quantities held ELSEWHERE, they imply an amount that should appear on the
 * waiver, and it warns when the typed figure falls short. This module is that
 * pattern, pointed at an estimate.
 *
 * ── WHAT IT REFUSES TO DO, WHICH IS WHAT KEEPS IT HONEST ──
 *
 * IT DOES NOT READ DESCRIPTIONS LOOKING FOR MEANING. "Hardware" is not a
 * concept this product has, and the repo's rule for `costCategory`,
 * `craftClassificationId`, `phaseCodeId` and the takeoff recipes is the same
 * one: classification is DECLARED, never guessed. A check that grepped line
 * text for "door" would fire on "Door frame patching" and stay silent on
 * "DR hdwe", and nobody could tell which. So every rule below keys on
 * something a person or the app declared: `postedAt`, `carriedAt`,
 * `costCategory`, and a description THIS APP generated deterministically.
 *
 * IT NEVER BLOCKS AND NEVER CONCLUDES. Advisory, derived on every read, stored
 * nowhere — `bid-margin.ts`, `bid-responsiveness.ts`, `addenda-overlap.ts`,
 * `lien-waiver.ts`. An estimator who traced a wall to get a number and
 * deliberately left it off the bid is not making a mistake, and this says what
 * it sees rather than what it thinks.
 *
 * ── WHY TWO RULES AND NOT SIX ──
 *
 * Because these are the two where the implying quantity is DECLARED. A third
 * candidate — openings deducted from board area imply door and window work —
 * was dropped on exactly the rule above: there is no declared opening TYPE,
 * only width and height, so naming what is missing would mean reading line
 * text. #616's lesson is the ceiling on this file: a warning that fires when
 * nothing is wrong teaches people to stop reading warnings, and a
 * cry-wolf cross-check would discredit the two that are sound.
 *
 * PURE. No database, no React, no clock.
 */

/** A measurement as this module needs it. Quantities are deliberately absent:
 * see `measuredNotPosted`. */
export type CrossCheckMeasurement = {
  id: string;
  kind: "LINEAR" | "AREA" | "COUNT";
  /** What the estimator called it, or null when they named nothing. */
  label: string | null;
  /** WHEN IT BECAME LINE ITEMS, or null. An event, not derived state. */
  postedAt: string | null;
};

/**
 * A carried quote, with the description the app WOULD write for it.
 *
 * `expectedDescription` comes from `carriedLinePlan`, so the comparison below
 * is against a string this app generates deterministically from the package
 * label and the vendor name — not against anything a person typed. The carried
 * action already matches on that same string for its own duplicate guard, so
 * this is the existing convention rather than a new one.
 */
export type CrossCheckCarriedQuote = {
  vendorName: string;
  packageLabel: string;
  amount: number;
  expectedDescription: string;
};

/** A live estimate line, as declared. */
export type CrossCheckLine = {
  description: string;
  costCategory: string | null;
  /** Already converted from Decimal by the caller. */
  budgetedUnitCost: number | null;
};

export type CrossCheck = {
  kind: "MEASURED_NOT_POSTED" | "CARRIED_QUOTE_MISSING";
  sentence: string;
};

/**
 * Traced on a drawing and never turned into line items.
 *
 * THE CLOSEST THING THIS PRODUCT HAS TO THE AUDIT'S OWN EXAMPLE. Somebody
 * calibrated a sheet, clicked along forty walls or counted fifty fixtures, and
 * the estimate has nothing from it. `postedAt` is the declared fact — the
 * schema calls it "an event, not derived state", written when measurements
 * become lines — so this needs no interpretation of anything.
 *
 * NO QUANTITIES IN THE SENTENCE, on purpose. A length only exists relative to
 * the calibration it was drawn against, and `measurementPrimitive` refuses to
 * produce one when that calibration is unreadable. Printing "320 LF" here
 * would mean either passing calibrations into this module or recomputing them
 * a second way, and a figure that disagreed with the takeoff tab's own by a
 * foot would be worse than no figure. The labels are what the estimator
 * recognises anyway: they are the names they typed.
 */
export function measuredNotPosted(measurements: readonly CrossCheckMeasurement[]): CrossCheck | null {
  const unposted = measurements.filter((m) => m.postedAt === null);
  if (unposted.length === 0) return null;

  const named = unposted.map((m) => m.label).filter((label): label is string => label !== null && label.trim() !== "");
  const count = unposted.length;
  const thing = count === 1 ? "measurement is" : "measurements are";

  // Named ones are listed because that is what makes it actionable; unnamed
  // ones are counted, because "and 2 more" is true and inventing a name for
  // them is not.
  const tail =
    named.length === 0
      ? ""
      : named.length === count
        ? ` — ${list(named)}`
        : ` — ${list(named)}, and ${count - named.length} unnamed`;

  return {
    kind: "MEASURED_NOT_POSTED",
    sentence: `${count} traced ${thing} not on the estimate${tail}. Measuring does not price it.`,
  };
}

/**
 * A price the estimator decided to carry that never reached the estimate.
 *
 * `carriedAt` is the declared decision — "the quote whose number went into our
 * bid, said by the estimator" — and a subcontract package is usually the
 * largest single line on a drywall bid. Carrying one and not putting it on is
 * money missing from the number a GC was sent.
 *
 * ── PRESENT IS TWO SIGNALS, EITHER OF WHICH IS ENOUGH ──
 *
 * The exact description the app would have written, OR a SUBCONTRACTOR line
 * whose budgeted cost equals the quote to the cent. One signal would have been
 * a cry-wolf generator: an estimator who renamed the line keeps a correct
 * estimate and would be told forever that the quote was missing. The second
 * signal costs nothing and is pure declared data — a category and a number.
 *
 * ── THE BOUND, WHICH IS REAL AND NOT PRETENDED AWAY ──
 *
 * `JobLineItem` has no `sourceBidQuoteId` — CLAUDE.md lists that as
 * deliberately deferred — so this cannot tie a specific line to a specific
 * quote. Two carried quotes at the SAME amount, with one posted and one not,
 * will read as both posted. That is the one case it misses, it is narrow, and
 * closing it is a schema change rather than a cleverer comparison.
 */
export function carriedQuotesMissing(
  carried: readonly CrossCheckCarriedQuote[],
  lines: readonly CrossCheckLine[],
): CrossCheck | null {
  if (carried.length === 0) return null;

  const descriptions = new Set(lines.map((line) => line.description));
  const subcontractorCosts = new Set(
    lines
      .filter((line) => line.costCategory === "SUBCONTRACTOR" && line.budgetedUnitCost !== null)
      .map((line) => cents(line.budgetedUnitCost as number)),
  );

  const missing = carried.filter(
    (quote) => !descriptions.has(quote.expectedDescription) && !subcontractorCosts.has(cents(quote.amount)),
  );
  if (missing.length === 0) return null;

  const named = missing.map((quote) => `${quote.vendorName} for ${quote.packageLabel}`);
  const verb = missing.length === 1 ? "is not on" : "are not on";
  return {
    kind: "CARRIED_QUOTE_MISSING",
    sentence: `${list(named)} ${verb} the estimate. You marked ${
      missing.length === 1 ? "that quote" : "those quotes"
    } as carried, so the bid is short unless the cost is somewhere else on it.`,
  };
}

/**
 * Everything this module has to say, in the order it should be read.
 *
 * A LIST AND NOT A VERDICT. There is no "estimate looks complete" here, for
 * `bid-responsiveness.ts`'s reason: this file cannot see what is missing that
 * it has no rule for, so saying nothing is wrong would be a claim about work
 * it never examined.
 */
export function estimateCrossChecks(input: {
  measurements: readonly CrossCheckMeasurement[];
  carried: readonly CrossCheckCarriedQuote[];
  lines: readonly CrossCheckLine[];
}): CrossCheck[] {
  return [
    // The carried quote first: it is money already decided, where an unposted
    // measurement is work that may yet be deliberately excluded.
    carriedQuotesMissing(input.carried, input.lines),
    measuredNotPosted(input.measurements),
  ].filter((check): check is CrossCheck => check !== null);
}

/** Whole cents, so a float comparison cannot miss by a rounding bit. */
function cents(value: number): number {
  return Math.round(value * 100);
}

/** "a", "a and b", "a, b and c" — the joiner `missingIndirects` uses. */
function list(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
