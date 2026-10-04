import { AI_FEATURES, modelFor, type AiFeatureKey } from "./models";

/**
 * WHAT A MODEL CALL COSTS — step 2 of the AI plan.
 *
 * `docs/ai/DECISIONS.md` has promised this twice and never had it: *"1,500 is a
 * figure, not a measurement. Whether it is sustainable depends on measured cost
 * per sheet, which step 2 produces"*, and *"Nothing prices that column today;
 * the cost work coming next will"*. `AskUsage` has recorded the model that ran
 * and four token counts since step 0, and nothing has ever multiplied them out.
 *
 * ── RATES ARE DATED, AND COST IS NEVER STORED ──
 *
 * CLAUDE.md: derived state is never stored, because a stored figure can
 * disagree with what it was derived from. A cost is tokens times a rate, so it
 * is computed at read time — and computed against the rate that applied ON THE
 * DAY of the row, not today's. That is why each model carries a LIST of rates
 * with a `from` date rather than one set of numbers: when a price changes, a
 * new entry is prepended and every historical figure stays true. A single
 * mutable rate would silently restate last quarter's bill.
 *
 * ── UNSET IS A VALUE, AND IT FAILS THE BUILD ──
 *
 * All five rates are recorded, read off the official pricing page on
 * 2026-10-02, and each carries a `source` string saying so. `pricingCensus.test.ts`
 * FAILS while any rate a live feature needs is unset — that assertion was the
 * gate on this PR, with two of its nine tests red by design until the real
 * numbers arrived, and it is now an ordinary census: it is what catches a model
 * routed somewhere unpriced, a rate with no provenance, or a history that is not
 * newest-first.
 *
 * `UNSET` stays, and is not vestigial. The next model routed here starts with
 * it, and a price change that moves only some of the four token figures records
 * the ones it knows and leaves the rest `UNSET` rather than carrying an old
 * number forward under a new `from` date. This file will not invent a rate: the
 * entire output of the module is a dollar figure somebody multiplies out to
 * decide whether an allowance is sustainable, and a confident wrong price is
 * worse than no price at all.
 *
 * ── THE CACHE-WRITE RATE IS THE ONE THAT CAN BE WRONG QUIETLY ──
 *
 * Anthropic publishes two: a 5-minute TTL and a 1-hour TTL, and for Opus 5 they
 * are $6.25 and $10 per MTok — a 60% difference on the same token. The 5-minute
 * figure is the right one here because `ask.ts` sends `cache_control: { type:
 * "ephemeral" }` with no `ttl`, which is the 5-minute default. If anybody adds
 * `ttl: "1h"` to a cache breakpoint, the rates below silently understate the
 * bill and nothing in this repo will say so — there is no per-row record of
 * which TTL a cache write used.
 */

/**
 * A rate nobody has confirmed.
 *
 * `null` rather than 0: a zero multiplies out to "this costs nothing", which is
 * indistinguishable from a cheap call and is exactly the wrong failure. Every
 * consumer has to handle the null, which is the point — `cost.ts` returns an
 * explicit "unknown, and here is what is missing" rather than a number.
 */
export const UNSET = null;

export type Rate = {
  /** ISO day this rate took effect. Rows before it use an earlier entry. */
  from: string;
  /** US dollars per million tokens. */
  inputPerMTok: number | null;
  outputPerMTok: number | null;
  /** Reading a cached prefix. Much cheaper than fresh input and NOT the same
   *  as free — Ask's system prompt is cached on every pass. */
  cacheReadPerMTok: number | null;
  /** Writing a prefix into the cache. Dearer than fresh input. */
  cacheWritePerMTok: number | null;
  /** Where each figure came from and when it was read. Asserted non-empty, so
   *  a number cannot arrive without a provenance. */
  source: string;
};

/**
 * Per-search web charge, in US dollars per thousand searches.
 *
 * Separate from the per-model table because it is not a model charge: the same
 * search costs the same whichever model asked for it. `lead-search` and
 * `bid-research` are the only two features that can incur it.
 */
export const WEB_SEARCH_PER_1K: number | null = 10;
export const WEB_SEARCH_SOURCE =
  "platform.claude.com/docs/en/about-claude/pricing, read 2026-10-02: \"Web search is available on " +
  "the Claude API for $10 per 1,000 searches, plus standard token costs\". Quoted in the same unit this " +
  "constant uses, so no conversion. A search that errors is not billed.";

/**
 * Rates per model id, NEWEST FIRST.
 *
 * Keyed by the exact id `FEATURE_MODEL` resolves to, so `pricing.test.ts` can
 * assert that every model a live feature runs on has a rate — both ends derived,
 * which is the shape every census here has had to learn.
 */
export const RATES: Record<string, Rate[]> = {
  "claude-opus-5": [
    {
      from: "2026-01-01",
      inputPerMTok: 5,
      outputPerMTok: 25,
      cacheReadPerMTok: 0.5,
      cacheWritePerMTok: 6.25,
      source:
        "platform.claude.com/docs/en/about-claude/pricing, read 2026-10-02. Input/output also match docs/ai/DECISIONS.md:102. Cache write is the 5-MINUTE rate ($6.25); the 1-hour rate is $10 and does not apply because `ask.ts` requests `{ type: \"ephemeral\" }` with no TTL, which is the 5m default. Ask is the only call site that caches at all.",
    },
  ],
  "claude-haiku-4-5": [
    {
      from: "2026-01-01",
      inputPerMTok: 1,
      outputPerMTok: 5,
      cacheReadPerMTok: 0.1,
      cacheWritePerMTok: 1.25,
      source:
        "platform.claude.com/docs/en/about-claude/pricing, read 2026-10-02. Input/output also match docs/ai/DECISIONS.md:102. Cache write is the 5-MINUTE rate ($1.25); the 1-hour rate is $2. Plan ingestion sets no cache_control, so these cache rates are currently unreachable for this model and are here for completeness.",
    },
  ],
};

/** The rate in force for `model` on `day` (an ISO date), or null. */
export function rateFor(model: string, day: string): Rate | null {
  const history = RATES[model];
  if (!history) return null;
  // Newest first, so the first entry at or before the day is the one that
  // applied. A row older than every entry has no rate rather than the oldest
  // one — guessing backwards past the earliest recorded price would invent a
  // figure for a period nobody priced.
  for (const rate of history) {
    if (rate.from <= day) return rate;
  }
  return null;
}

/**
 * Every model a live feature can run on, derived from the feature registry.
 *
 * Through `modelFor` rather than the private rate map, which is the better
 * source anyway: it applies the env override, so this is the model that will
 * ACTUALLY run rather than the compiled-in default. Point
 * `ANTHROPIC_MODEL_PLAN_INGESTION` at something unpriced and the census below
 * says so instead of pricing a model nobody is using.
 */
export function pricedModels(): string[] {
  const keys = Object.keys(AI_FEATURES) as AiFeatureKey[];
  return [...new Set(keys.map((feature) => modelFor(feature).model))];
}

/** Which of a rate's four token figures are still unset. */
export function missingTokenRates(rate: Rate): string[] {
  const missing: string[] = [];
  if (rate.inputPerMTok === null) missing.push("input");
  if (rate.outputPerMTok === null) missing.push("output");
  if (rate.cacheReadPerMTok === null) missing.push("cache read");
  if (rate.cacheWritePerMTok === null) missing.push("cache write");
  return missing;
}
