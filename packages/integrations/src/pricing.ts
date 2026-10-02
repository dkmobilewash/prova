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
 * Only two of the five rates are recorded anywhere in this repo — Opus 5 at
 * $5/$25 per MTok and Haiku 4.5 at $1/$5, in `DECISIONS.md:102`. Cache reads,
 * cache writes and web searches are not, and this file will not invent them: the
 * entire output of this module is a dollar figure somebody multiplies out, and a
 * confident wrong price is worse than no price at all.
 *
 * So they are `UNSET`, and `pricing.test.ts` FAILS while any rate a live feature
 * needs is unset. That is deliberate and it is not a broken build: it means the
 * PR carrying this cannot merge until the real numbers are pasted in from the
 * Anthropic console. `main` never goes red; the gate sits on the change.
 *
 * Fill one in by replacing `UNSET` with the number and its source — the test
 * also requires every rate to carry a `source` saying where it came from and
 * when it was read, so a figure cannot arrive anonymously.
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
export const WEB_SEARCH_PER_1K: number | null = UNSET;
export const WEB_SEARCH_SOURCE = "";

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
      cacheReadPerMTok: UNSET,
      cacheWritePerMTok: UNSET,
      source: "input/output: docs/ai/DECISIONS.md:102, recorded 2026-09-26. Cache rates not yet confirmed.",
    },
  ],
  "claude-haiku-4-5": [
    {
      from: "2026-01-01",
      inputPerMTok: 1,
      outputPerMTok: 5,
      cacheReadPerMTok: UNSET,
      cacheWritePerMTok: UNSET,
      source: "input/output: docs/ai/DECISIONS.md:102, recorded 2026-09-26. Cache rates not yet confirmed.",
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
