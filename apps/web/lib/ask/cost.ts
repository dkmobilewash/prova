import { rateFor, missingTokenRates, WEB_SEARCH_PER_1K } from "@prova/integrations";

/**
 * WHAT A RECORDED PASS COST — the read-time half of step 2.
 *
 * Pure and dependency-free apart from the rate table, so it is testable in a
 * millisecond and so the arithmetic lives somewhere a person can argue with it.
 * `ARCHITECTURE.md`'s rule holds all the way down here: the model narrates, the
 * arithmetic is deterministic code.
 *
 * ── NOTHING IS STORED, AND THE DATE IS WHY ──
 *
 * CLAUDE.md: derived state is never stored. A cost is tokens times a rate, and
 * storing it would let a figure disagree with its own inputs the first time a
 * price moved. So every figure here is computed from the row, against the rate
 * that applied ON THE ROW'S OWN DAY — `rateFor` takes the day for exactly that
 * reason. Re-reading last quarter gives last quarter's prices.
 *
 * ── AN UNKNOWN COST IS A RESULT, NOT A ZERO ──
 *
 * All five rates are recorded as of 2026-10-02 (see `pricing.ts`), so no row
 * written by a currently-routed model reads unknown today. That is a fact about
 * this week, not a property of the design: a model routed in next month arrives
 * with no rate at all, and a price change recorded for only some token kinds
 * arrives with a partial one. Both must read as "unknown", never as "$0.00" — a
 * zero on a cost screen says the call was free, which is the one reading that
 * stops anybody asking. So `costOf` returns a discriminated result, and every
 * caller has to render the unknown case; the type makes that unavoidable rather
 * than optional, and it stays that way after the table is complete.
 *
 * ── AND THE HISTORY IS HONEST ABOUT BEING A FLOOR ──
 *
 * `AskUsage.webSearches` arrived on 2026-10-02. Rows written before it read 0,
 * which is correct for the seven features that never search and a FLOOR for the
 * two that do: the API reported the real count at the time and nothing wrote it
 * down, so it cannot be recovered. A total spanning that date is understated by
 * an unknowable amount, and `spendOver` says so rather than presenting it as
 * complete.
 */

/** The day `webSearches` began being recorded. Rows before it under-report. */
export const WEB_SEARCHES_RECORDED_FROM = "2026-10-02";

/** What a priced row needs. A subset of `AskUsage`, so a query can select it. */
export type PricedRow = {
  model: string;
  createdAt: Date;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
};

export type Cost =
  | { known: true; usd: number }
  /** What is missing, in words a person can act on. */
  | { known: false; missing: string[] };

/**
 * How a rate is found. Injectable for ONE reason, which is the reason
 * `leadFinder.ts` gives for its own ports: a branch that cannot be reached is a
 * branch that is not tested.
 *
 * While three rates were unset, "a rate this row needs is missing" was
 * reachable with the real table. Now that all five are filled, the only way a
 * row hits that branch is a model added later with a partial rate — which is
 * exactly when it matters and exactly when nobody is looking. Production passes
 * nothing and uses `rateFor`.
 */
export type RateLookup = (model: string, day: string) => ReturnType<typeof rateFor>;

const PER_MTOK = 1_000_000;
const PER_1K = 1_000;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * One row's cost, or what stops it being computable.
 *
 * A row with web searches and no web-search rate is UNKNOWN rather than
 * "tokens only" — a partial figure presented as a cost is the same defect as a
 * zero, and lead search is mostly search charge.
 */
export function costOf(row: PricedRow, lookup: RateLookup = rateFor): Cost {
  const day = isoDay(row.createdAt);
  const rate = lookup(row.model, day);
  if (!rate) {
    return { known: false, missing: [`no rate recorded for ${row.model} on ${day}`] };
  }

  const missing: string[] = [];
  // Only the rates this row actually USES. A row with no cached tokens does
  // not need a cache rate, so an unset one must not make it unpriceable —
  // otherwise every row in the app reads unknown until all five are filled,
  // and the per-unit figures step 2 exists for stay unavailable for no reason.
  const needed = missingTokenRates(rate).filter((which) => {
    if (which === "input") return row.inputTokens > 0;
    if (which === "output") return row.outputTokens > 0;
    if (which === "cache read") return row.cacheReadTokens > 0;
    return row.cacheWriteTokens > 0;
  });
  missing.push(...needed.map((which) => `${which} rate for ${row.model}`));

  if (row.webSearches > 0 && WEB_SEARCH_PER_1K === null) {
    missing.push("web search rate");
  }
  if (missing.length > 0) return { known: false, missing };

  const usd =
    (row.inputTokens * (rate.inputPerMTok ?? 0)) / PER_MTOK +
    (row.outputTokens * (rate.outputPerMTok ?? 0)) / PER_MTOK +
    (row.cacheReadTokens * (rate.cacheReadPerMTok ?? 0)) / PER_MTOK +
    (row.cacheWriteTokens * (rate.cacheWritePerMTok ?? 0)) / PER_MTOK +
    (row.webSearches * (WEB_SEARCH_PER_1K ?? 0)) / PER_1K;

  return { known: true, usd };
}

export type Spend = {
  /** Rows that could be priced, and what they came to. */
  usd: number;
  priced: number;
  /** Rows that could not be priced, and every distinct reason. */
  unpriced: number;
  missing: string[];
  /** True when any row predates `webSearches` being recorded, so the total is
   *  a floor rather than a figure. */
  understated: boolean;
};

/**
 * A set of rows, added up, with what it could not price kept beside it.
 *
 * NOT A SUM THAT SILENTLY SKIPS. `absence of a failure is not a pass` applies
 * to arithmetic too: a total over nine rows that could only price four is a
 * different number from a total over nine, and the one thing it must not do is
 * look like the second. So `priced` and `unpriced` come back with it and the
 * screen prints both.
 */
export function spendOver(rows: readonly PricedRow[], lookup: RateLookup = rateFor): Spend {
  let usd = 0;
  let priced = 0;
  let unpriced = 0;
  let understated = false;
  const missing = new Set<string>();

  for (const row of rows) {
    if (isoDay(row.createdAt) < WEB_SEARCHES_RECORDED_FROM) understated = true;
    const cost = costOf(row, lookup);
    if (cost.known) {
      usd += cost.usd;
      priced += 1;
    } else {
      unpriced += 1;
      for (const reason of cost.missing) missing.add(reason);
    }
  }

  return { usd, priced, unpriced, missing: [...missing].sort(), understated };
}

/**
 * Cost per unit of work — the figure step 2 exists to produce.
 *
 * `DECISIONS.md`'s open question is whether 1,500 plan sheets and 600 addendum
 * pages a month are sustainable, and it says only a measured per-unit cost can
 * answer it. `units` is the count the allowance is denominated in — sheets for
 * plan ingestion, pages for a document read — and comes from the caller, never
 * from a row count: a plan-sheet row IS one sheet, but a document read is one
 * row and many pages, so counting rows would quietly divide by the wrong thing.
 *
 * Returns null rather than Infinity or 0 when there is nothing to divide by. A
 * month with no plan sheets has no cost per sheet, and inventing one from a
 * single row would be the most confidently wrong number on the page.
 */
export function costPerUnit(spend: Spend, units: number): number | null {
  if (units <= 0) return null;
  if (spend.priced === 0) return null;
  return spend.usd / units;
}

/** What a month at the allowance ceiling would cost, at the measured rate. */
export function costAtAllowance(perUnit: number | null, allowance: number): number | null {
  if (perUnit === null) return null;
  return perUnit * allowance;
}
