import { extendedCost, extendedPrice, type RecapLine } from "@/lib/bid-recap";

/**
 * DOES THIS BID COVER WHAT IT COSTS TO BUILD?
 *
 * Nothing in this app asked that until 2026-10-04. The 2026-10-04 workflow
 * audit put it plainly: cost-base integrity checks exist (`uncategorised`,
 * `pricedWithNoCost`) and nothing anywhere says a bid is priced under cost.
 *
 * ── IT MEASURES THE LINE PRICES, NEVER THE RECAP TOTAL, AND THAT IS THE WHOLE
 *    DESIGN ──
 *
 * The obvious implementation is `(bidTotal − direct.total) / bidTotal`, and it
 * is **unreachable code with a sentence attached**. `bidRecap()` derives
 * `bidTotal` as the direct cost plus markup, escalation, tax, overhead, profit,
 * bond and contingency; `rate()` turns a missing or non-finite percentage into
 * 0, and `nullablePercentFromForm` bounds a typed one to 0–100. So every step
 * adds `base × percent / 100` with `percent >= 0`, `bidTotal >= direct.total`
 * ALWAYS, and that ratio is the sum of the rates restated — positive by
 * construction. A warning on it could never fire. `bidMarginVacuityProof` in
 * the test file pins exactly that, so the next person to "simplify" this onto
 * `bidTotal` finds out from a red build rather than from a bid.
 *
 * What can actually be wrong is the prices ON THE LINES — what the schedule of
 * values prints and what a GC is asked to pay. They go under cost in three real
 * ways: a price typed by hand below cost, a recap that was never applied, and
 * lines added after Apply.
 *
 * ── THE FALSE POSITIVE THIS EXISTS TO AVOID ──
 *
 * A COST-ONLY LINE IS CORRECT, NOT A MISTAKE. A line with a real cost and
 * `unitPrice: null` — general conditions, supervision, cleanup — carries cost
 * and deliberately receives no price back: `spreadToLines` filters it out
 * because "general conditions are recovered through the billable lines". Before
 * Apply that recovery is not on the lines yet, so the prices genuinely total
 * less than the costs **on an estimate that is perfectly correct and simply
 * unfinished**.
 *
 * So `costOnlyLineCount` rides along and the sentence names those lines when
 * there are any. Diego chose "warn on under-cost only" precisely so this could
 * not cry wolf; a warning that fires on correct work is the one people learn to
 * ignore, and then the real one is missed too.
 *
 * ── AND THE CONTAMINANT IN THE OTHER DIRECTION ──
 *
 * `pricedWithNoCost` — a line with a price and no cost — adds revenue and no
 * cost, so it reads the margin HIGH. That makes an `UNDER_COST` verdict MORE
 * certain rather than less (the bid fails to cover its costs even with free
 * revenue in the numerator), but it is reported in every state anyway, because
 * a margin stated without its contaminants is exactly the "real-looking number
 * that will be remembered and repeated" `bid-outcome.ts` refuses to produce.
 *
 * ── IT IS A BID-TIME MARGIN, AND THREE OTHER THINGS IN THIS APP ARE CALLED
 *    MARGIN ──
 *
 * `company-financials.ts` has `HEALTHY_MARGIN_RATE`/`marginIsHealthy`, `wip.ts`
 * has gross margin per job, and `conceptual-estimate.ts` has the gap between
 * sell and cost on historical jobs. **All three are post-award, computed on
 * actual cost.** This is the only one about prices nobody has been paid yet and
 * costs nobody has incurred, which is why it is a separate function rather than
 * a fourth caller of one of those — `bid-outcome.ts`'s rule is "one definition,
 * three surfaces", and these are genuinely two definitions of two things.
 *
 * ADVISORY, NEVER BLOCKING. Nothing here refuses a save or a print. A sub may
 * bid under cost on purpose to keep a crew together through a slow month, and
 * an app that argued with them would be wrong about the world — the rule
 * `lien-waiver.ts` states as "refusing the save would make the app wrong about
 * the world and teach people to route around it."
 *
 * PURE. No database, no React, no clock. Computed on every read and never
 * stored: a stored margin is wrong the moment a line changes.
 */

/** What the lines say, once. Every state carries the contaminant counts. */
type MarginFacts = {
  /** Σ quantity × unitPrice. */
  priced: number;
  /** Σ quantity × budgetedUnitCost. */
  cost: number;
  /** Lines with a real cost and NO price — recovered through other lines. */
  costOnlyLineCount: number;
  /** Lines with a price and NO cost — revenue the cost base does not include. */
  pricedWithNoCostLineCount: number;
};

export type BidMargin =
  | ({ state: "NO_PRICES" } & MarginFacts)
  | ({ state: "NO_COSTS" } & MarginFacts)
  | ({ state: "UNDER_COST"; shortfall: number; rate: number } & MarginFacts)
  | ({ state: "COVERED"; margin: number; rate: number } & MarginFacts);

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The bid's margin, as a state rather than a number.
 *
 * `NO_COSTS` is not a 0% margin and not a 100% one. A `$0` cost base is the
 * honest, ordinary state of a wizard-built, AI-drafted or QuickBooks-sourced
 * job — `bid-recap.ts` says so itself — and the only true answer is that
 * nothing here knows what this work costs.
 */
export function bidMargin(lines: readonly RecapLine[]): BidMargin {
  let priced = 0;
  let cost = 0;
  let costOnlyLineCount = 0;
  let pricedWithNoCostLineCount = 0;

  for (const line of lines) {
    const linePrice = extendedPrice(line);
    const lineCost = extendedCost(line);
    priced += linePrice;
    cost += lineCost;
    // `unitPrice == null` rather than `linePrice === 0`: a line deliberately
    // priced at zero is a priced line, and a quantity of zero is not a missing
    // price. The two must not be conflated — one is a decision, the other is a
    // gap, and only the gap is recovered elsewhere.
    if (line.unitPrice == null && lineCost > 0) costOnlyLineCount += 1;
    if (line.unitPrice != null && lineCost === 0) pricedWithNoCostLineCount += 1;
  }

  priced = round2(priced);
  cost = round2(cost);
  const facts: MarginFacts = { priced, cost, costOnlyLineCount, pricedWithNoCostLineCount };

  if (priced === 0) return { state: "NO_PRICES", ...facts };
  if (cost === 0) return { state: "NO_COSTS", ...facts };

  const margin = round2(priced - cost);
  // Against the PRICE, which is what a contractor means by a margin — a figure
  // over cost is a markup and the two differ by enough to matter on a bid.
  const rate = margin / priced;

  if (margin < 0) return { state: "UNDER_COST", shortfall: Math.abs(margin), rate, ...facts };
  return { state: "COVERED", margin, rate, ...facts };
}

/**
 * "18.4%" — this module's own format, one decimal and a sign for a negative.
 *
 * NOT a reuse of `formatPercentComplete`. `wip.ts` states the rule it is
 * following: "one shared function per on-screen format, not one function
 * pretending both formats are the same." That one never goes negative and this
 * one must, visibly.
 */
export function formatMarginRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * The sentence shown when a bid does not cover its cost, or null.
 *
 * NULL FOR EVERY OTHER STATE, so the caller renders nothing rather than an
 * empty box — `proposalPriceWarning` does the same and for the same reason.
 *
 * Addressed to the person about to send the bid, names the money rather than
 * the percentage, and names the cost-only lines when they exist because those
 * are the one honest explanation for a shortfall on a correct estimate. It does
 * not say what to do, because there are three right answers (raise the prices,
 * apply the recap, or send it anyway on purpose) and the app does not know
 * which.
 */
export function underCostWarning(result: BidMargin, money: (value: number) => string): string | null {
  if (result.state !== "UNDER_COST") return null;

  const head =
    `These line prices come to ${money(result.priced)} against ${money(result.cost)} of cost — ` +
    `${money(result.shortfall)} under what this work costs to build.`;

  if (result.costOnlyLineCount > 0) {
    const n = result.costOnlyLineCount;
    return (
      `${head} ${n} ${n === 1 ? "line carries" : "lines carry"} cost with no price, which the bid ` +
      `recovers through the priced lines — if the markup has not been applied yet, that is where the ` +
      `shortfall is.`
    );
  }
  return head;
}
