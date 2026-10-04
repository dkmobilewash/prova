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

/** The tokens and searches a figure was computed from. */
export type Tokens = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
};

/**
 * What a total was computed FROM, so a person can check it.
 *
 * ── A COST NOBODY CAN RECONCILE IS A COST NOBODY SHOULD TRUST ──
 *
 * Added 2026-10-02 from a click-through of the panel this module feeds. The
 * screen showed `$0.43` while the usage block directly above it read
 * "1,285 tokens in, 267 out" — which multiplies out to about a cent. The $0.43
 * was CORRECT: roughly 67,000 cache-WRITE tokens at $6.25/MTok, from Ask
 * caching its system prompt and tool definitions at four breakpoints. But the
 * screen displayed only two of the four token kinds it charges for, so the
 * figure could not be checked from the page, and the tester's first conclusion
 * was that a rate had been entered per-1,000 instead of per-million — which
 * would have meant every figure on a money screen was 1,000x overstated.
 *
 * That is the failure worth preventing. The arithmetic was never wrong; the
 * screen made a right answer indistinguishable from a catastrophic one, and the
 * only way to tell them apart was to read the database. A cost figure whose
 * inputs are invisible gets distrusted when it is right and trusted when it is
 * wrong, and both directions are expensive.
 *
 * Counted over the rows that were PRICED only, deliberately: the total is a sum
 * over those rows, so showing tokens from unpriced rows beside it would
 * reintroduce exactly the mismatch this function exists to close.
 */
export function tokensOver(rows: readonly PricedRow[], lookup: RateLookup = rateFor): Tokens {
  const sum: Tokens = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearches: 0,
  };
  for (const row of rows) {
    if (!costOf(row, lookup).known) continue;
    sum.inputTokens += row.inputTokens;
    sum.outputTokens += row.outputTokens;
    sum.cacheReadTokens += row.cacheReadTokens;
    sum.cacheWriteTokens += row.cacheWriteTokens;
    sum.webSearches += row.webSearches;
  }
  return sum;
}

/** The usage counters a period carries, structurally — so this module needs no
 *  Prisma import and the straddle case below is testable without a database. */
export type PeriodUsage = {
  periodStart: Date;
  questionsUsed: number;
  pagesUsed: number;
  planSheetsUsed: number;
  addendumPagesUsed: number;
  /** Spec section pages. Its own unit, never shared with addendum pages — a
   *  section is 30-60 pages against an addendum's 2-20, so one ledger would
   *  mean reading specs silently spending the allowance for reading addenda. */
  specPagesUsed: number;
  failedQuestions: number;
  failedPages: number;
  failedPlanSheets: number;
  failedAddendumPages: number;
  failedSpecPages: number;
};

export type AllowanceUsage = Omit<PeriodUsage, "periodStart"> & {
  /** True when a period reaching back BEFORE the window contributed its whole
   *  count, so every per-unit figure derived from this is an UNDER-estimate. */
  straddled: boolean;
};

/** Midnight UTC on the first of `date`'s month — where a period begins. */
export function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * The units claimed across every allowance period overlapping the window.
 *
 * ── A COST OVER 30 DAYS DIVIDED BY THE UNITS OF ONE PERIOD IS NOT A COST PER
 *    UNIT, AND THAT IS WHAT SHIPPED ──
 *
 * Found by clicking the panel on 2026-10-02. The numerator was every row in the
 * last 30 days; the denominator was `findFirst` over allowance periods — ONE
 * period. Two separate defects in that one line:
 *
 *   - **It fails blank.** With no period starting inside the window, `findFirst`
 *     returns null, every count reads 0, and every row says "no questions this
 *     month" while the usage block above shows calls in the same window. That is
 *     the symptom the click-through actually hit.
 *   - **It fails LOUD on the 1st of a month.** Thirty days of spend over two
 *     days of usage renders a confident per-sheet figure, with an "a month would
 *     be" line under it — up to ~15x too high, and it is the number that feeds
 *     the $399 pricing decision `DECISIONS.md` has open. `costPerUnit`'s own
 *     docstring calls an invented per-unit figure "the most confidently wrong
 *     number on the page". It was producing one, systematically, monthly.
 *
 * So the denominator now covers the same window as the numerator: every period
 * overlapping it, summed. A period is a UTC calendar MONTH with no end column
 * (`ask-allowance.prisma`), so the periods that can overlap are those starting
 * at or after the first of the window's own month.
 *
 * ── THE STRADDLE IS REAL AND IS REPORTED RATHER THAN HIDDEN ──
 *
 * The earliest period can begin BEFORE `from` — a 30-day window opening 2 Oct
 * reaches back into September, whose period began 1 Sept — and its counters are
 * per-period, not per-day, so it contributes September 1st as well. There is no
 * way to apportion it: nothing records which day a unit was claimed on. That
 * makes the denominator slightly too LARGE and every per-unit figure slightly
 * too SMALL, so the error is an under-estimate rather than an over-estimate,
 * which is the right direction for a figure someone will quote as a cost.
 *
 * `straddled` says so, and the panel prints it. Option B — narrowing the
 * numerator to the period instead — was rejected: on the 2nd of a month it would
 * report a cost per sheet from two days of data, which is a worse measurement
 * than a slightly conservative one over thirty, and it answers a question nobody
 * asked ("what did it cost since Tuesday") instead of the one they did.
 */
export function allowanceOver(periods: readonly PeriodUsage[], from: Date): AllowanceUsage {
  const sum: AllowanceUsage = {
    questionsUsed: 0,
    pagesUsed: 0,
    planSheetsUsed: 0,
    addendumPagesUsed: 0,
    specPagesUsed: 0,
    failedQuestions: 0,
    failedPages: 0,
    failedPlanSheets: 0,
    failedAddendumPages: 0,
    failedSpecPages: 0,
    straddled: false,
  };
  for (const period of periods) {
    if (period.periodStart < from) sum.straddled = true;
    sum.questionsUsed += period.questionsUsed;
    sum.pagesUsed += period.pagesUsed;
    sum.planSheetsUsed += period.planSheetsUsed;
    sum.addendumPagesUsed += period.addendumPagesUsed;
    sum.specPagesUsed += period.specPagesUsed;
    sum.failedQuestions += period.failedQuestions;
    sum.failedPages += period.failedPages;
    sum.failedPlanSheets += period.failedPlanSheets;
    sum.failedAddendumPages += period.failedAddendumPages;
    sum.failedSpecPages += period.failedSpecPages;
  }
  return sum;
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
