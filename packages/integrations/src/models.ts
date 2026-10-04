/**
 * Which model each AI feature runs on, and the client options every caller
 * shares.
 *
 * WHY THIS FILE EXISTS. `claude-opus-5` was written inline in SIX places
 * (`ask.ts` twice, `anthropic.ts` three times, `research.ts` and `leads.ts`
 * once each) with no env var and no config anywhere. Changing the model meant a
 * code change and a deploy, trying a cheaper one on high-volume work was not
 * possible at all, and nothing recorded WHY a given caller was on a given
 * model. Step 0 of the AI plan.
 *
 * THE DEFAULT IS OPUS 5 EVERYWHERE, AND ONE FEATURE IS DELIBERATELY CHEAPER.
 * Downgrading a model to save money is the caller's decision, not a default to
 * be inherited — so every feature here is Opus 5 unless Diego asked for
 * otherwise, and he asked for exactly one thing: high-volume page work
 * (classification, title blocks) may run on a smaller model, "with the eval
 * deciding whether it's good enough". So `PLAN_INGESTION` is Haiku 4.5 and the
 * eval is what confirms or reverses that, not this comment.
 *
 * Haiku 4.5 is $1/$5 per MTok against Opus 5's $5/$25 — a fifth of the price on
 * the one workload that runs three hundred times per upload. If the eval says
 * it is not good enough, the fix is one line here.
 */

/**
 * Model ids, exactly as Anthropic spells them.
 *
 * NEVER DATE-SUFFIXED. `claude-haiku-4-5`, not `claude-haiku-4-5-20251001` —
 * the ids are complete as they stand and a remembered date suffix is a 404 that
 * looks like a typo. Checked against the `claude-api` skill rather than written
 * from memory, which is also why this list is short: a model nobody has chosen
 * for a feature does not belong in it.
 */
export const OPUS_5 = "claude-opus-5";
export const HAIKU_4_5 = "claude-haiku-4-5";

/** Every model this app is allowed to route to, for validating an override. */
export const KNOWN_MODELS: readonly string[] = [OPUS_5, HAIKU_4_5];

/**
 * The AI features that spend money, matching `AskUsage.feature` and the
 * `AiFeature` enum in the schema.
 *
 * A `const` object rather than a bare union so the per-feature default below
 * can be a total `Record` — it does not compile until every feature has a
 * model, which is the shape #526 landed for `CostCategory` after a missing
 * member produced a NaN bid total from an unwired index.
 */
export const AI_FEATURES = {
  ASK: "ask",
  WIP_NARRATIVE: "wip-narrative",
  COMPLIANCE_EXTRACT: "compliance-extract",
  DRAFT_ESTIMATE_LINES: "draft-estimate-lines",
  BID_RESEARCH: "bid-research",
  LEAD_SEARCH: "lead-search",
  QUOTE_EXTRACT: "quote-extract",
  PLAN_INGESTION: "plan-ingestion",
  ADDENDUM_READ: "addendum-read",
  SPEC_READ: "spec-read",
} as const;

export type AiFeatureKey = keyof typeof AI_FEATURES;
export type AiFeatureName = (typeof AI_FEATURES)[AiFeatureKey];

export const AI_FEATURE_NAMES: readonly AiFeatureName[] = Object.values(AI_FEATURES);

/**
 * The model each feature runs on absent any override. A total Record: adding a
 * feature above without choosing its model does not compile.
 */
const FEATURE_MODEL: Record<AiFeatureKey, string> = {
  ASK: OPUS_5,
  WIP_NARRATIVE: OPUS_5,
  COMPLIANCE_EXTRACT: OPUS_5,
  DRAFT_ESTIMATE_LINES: OPUS_5,
  BID_RESEARCH: OPUS_5,
  LEAD_SEARCH: OPUS_5,
  // Opus, and worth saying why when the neighbour below is Haiku: this reads ONE
  // document per bid, not three hundred pages, so the cheap model buys almost
  // nothing — and what it would risk is a misread price on the number an
  // estimator is about to level two subs against. Volume is what justifies
  // Haiku for ingestion; there is no volume here.
  QUOTE_EXTRACT: OPUS_5,
  // The one cheap default, at Diego's direction, subject to the eval. Three
  // hundred calls per plan set is where a fifth of the price is worth having.
  PLAN_INGESTION: HAIKU_4_5,
  // Opus, and the argument cuts closer here than anywhere else on this list.
  // An addendum reader is 2-6 documents per bid rather than the quote reader's
  // one, so it IS more volume — but the test this file applies is not "more
  // than one", it is the one in the header: every feature is Opus unless Diego
  // asked otherwise, and he asked for exactly one thing, "high-volume page
  // work (classification, title blocks)". Three documents is not three hundred
  // pages, and the per-document stakes are the quote's rather than a sheet's:
  // a missed item on a GC's letter is a scope change nobody re-priced, on a
  // document submitted once. The eval is what may reverse this, not this
  // comment.
  ADDENDUM_READ: OPUS_5,
  SPEC_READ: OPUS_5,
};

/** `ANTHROPIC_MODEL_PLAN_INGESTION` etc. — the per-feature env override. */
export function modelEnvVar(feature: AiFeatureKey): string {
  return `ANTHROPIC_MODEL_${feature}`;
}

export type ModelChoice = {
  model: string;
  /** Where the id came from, so a log line can say. */
  source: "company-override" | "feature-env" | "default-env" | "feature-default";
};

/**
 * The model for one feature, and where the choice came from.
 *
 * Precedence, most specific first:
 *
 *   1. `companyOverride` — one customer wanting everything on one model.
 *   2. `ANTHROPIC_MODEL_<FEATURE>` — an operator trying a model on one feature.
 *   3. `ANTHROPIC_MODEL_DEFAULT` — an operator moving everything at once.
 *   4. The per-feature default above.
 *
 * AN UNKNOWN ID IS IGNORED, NOT PASSED THROUGH, and this is the decision worth
 * reading. A typo'd env var or a stale company override would otherwise reach
 * the API as a 404 on every call for that feature — which surfaces as "the
 * assistant is unavailable", the same symptom as a missing key, with nothing
 * naming the cause. Falling back to a model that works, and returning the
 * `source` so a log line can say the override was ignored, is the failure mode
 * a person can act on. `saveCompanyAiSettings` validates on write for the same
 * reason; this is the belt to that braces.
 */
export function modelFor(feature: AiFeatureKey, companyOverride?: string | null): ModelChoice {
  const known = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed && KNOWN_MODELS.includes(trimmed) ? trimmed : null;
  };

  const override = known(companyOverride);
  if (override) return { model: override, source: "company-override" };

  const perFeature = known(process.env[modelEnvVar(feature)]);
  if (perFeature) return { model: perFeature, source: "feature-env" };

  const fallback = known(process.env.ANTHROPIC_MODEL_DEFAULT);
  if (fallback) return { model: fallback, source: "default-env" };

  return { model: FEATURE_MODEL[feature], source: "feature-default" };
}

/**
 * The client options every caller passes, so timeout and retry behaviour is one
 * decision rather than six defaults nobody chose.
 *
 * WHAT THE SDK ALREADY DID, because the plan got this wrong and the correction
 * matters: `maxRetries` already defaulted to **2** and `timeout` to ten
 * minutes. Retries were never missing. What was missing was an explicit,
 * reviewable setting — the difference between behaviour somebody chose and
 * behaviour nobody knew they had.
 *
 * MILLISECONDS, NOT SECONDS. The TypeScript SDK takes `timeout` in ms where
 * Python takes seconds; a `60` here would be sixty milliseconds and would fail
 * every call. Written out rather than as a bare number for that reason.
 */
export const AI_CLIENT_OPTIONS = {
  /**
   * Two minutes. Below the SDK's ten-minute default because every caller in
   * this app is a single one-shot call or a bounded six-pass loop, and a
   * request still open after two minutes is one a person has already given up
   * on. The Ask loop streams, so its wall-clock is per pass rather than total.
   */
  timeout: 2 * 60 * 1000,
  /**
   * Three rather than the default two, since the retryable set (408, 409, 429,
   * 5xx, connection errors) is exactly the set worth another go, and one extra
   * attempt is cheap against a person re-asking. Worst-case wall clock is
   * `timeout × (maxRetries + 1)`, which is why the timeout above came down.
   */
  maxRetries: 3,
} as const;
