import { afterEach, describe, expect, it } from "vitest";
import {
  AI_CLIENT_OPTIONS,
  AI_FEATURES,
  AI_FEATURE_NAMES,
  HAIKU_4_5,
  KNOWN_MODELS,
  OPUS_5,
  modelEnvVar,
  modelFor,
} from "@prova/integrations";

/**
 * Which model a feature runs on, and what happens when the answer is wrong.
 *
 * WHY THIS TEST IS IN `apps/web` WHEN `models.ts` IS IN `packages/integrations`.
 * `packages/integrations` has no test runner — no vitest config, no `test`
 * script — so a `*.test.ts` beside the module would be collected by NOTHING,
 * which `testRunnerCensus.test.ts` exists to fail the build over. It was
 * written for exactly this: 161 `.dbtest.ts` files that no runner referenced,
 * green by absence.
 *
 * Giving that package a runner needs vitest in its devDependencies, which is a
 * lockfile change and a `--frozen-lockfile` risk in CI for no gain today. Every
 * test in this repository already lives in `apps/web`, which is also the only
 * consumer of the module. If the AI work accumulates enough package-side logic
 * to want its own runner, that is its own small PR.
 *
 * The behaviour worth pinning is not the happy path — it is that a BAD override
 * is ignored rather than passed through. A typo'd env var or a stale company
 * setting reaching the API is a 404 on every call for that feature, which
 * surfaces as "the assistant is unavailable": the same symptom as a missing
 * key, with nothing naming the cause. `#118` and the ANTHROPIC_API_KEY scar are
 * both this shape — a config problem wearing an outage's clothes.
 */

const ENV_KEYS = ["ANTHROPIC_MODEL_DEFAULT", ...Object.keys(AI_FEATURES).map((k) => modelEnvVar(k as never))];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("the model each feature runs on", () => {
  it("is Opus 5 for everything except plan ingestion", () => {
    for (const feature of ["ASK", "WIP_NARRATIVE", "COMPLIANCE_EXTRACT", "DRAFT_ESTIMATE_LINES", "BID_RESEARCH", "LEAD_SEARCH"] as const) {
      expect(modelFor(feature).model, feature).toBe(OPUS_5);
    }
  });

  it("is Haiku 4.5 for plan ingestion — the one cheap default, and it is deliberate", () => {
    // Three hundred calls per plan set at a fifth of the price. Diego asked for
    // it and the eval is what confirms or reverses it.
    const choice = modelFor("PLAN_INGESTION");
    expect(choice.model).toBe(HAIKU_4_5);
    expect(choice.source).toBe("feature-default");
  });

  it("names no model with a date suffix", () => {
    // `claude-haiku-4-5-20251001` is a 404 that reads like a typo. The ids are
    // complete as they stand.
    for (const model of KNOWN_MODELS) {
      expect(model, model).not.toMatch(/-\d{8}$/);
    }
  });
});

describe("overrides, in order of specificity", () => {
  it("prefers a company override over everything", () => {
    process.env.ANTHROPIC_MODEL_DEFAULT = OPUS_5;
    process.env[modelEnvVar("PLAN_INGESTION")] = OPUS_5;
    expect(modelFor("PLAN_INGESTION", HAIKU_4_5)).toEqual({ model: HAIKU_4_5, source: "company-override" });
  });

  it("prefers a per-feature env var over the default env var", () => {
    process.env.ANTHROPIC_MODEL_DEFAULT = OPUS_5;
    process.env[modelEnvVar("PLAN_INGESTION")] = HAIKU_4_5;
    expect(modelFor("PLAN_INGESTION")).toEqual({ model: HAIKU_4_5, source: "feature-env" });
  });

  it("uses the default env var when no per-feature one is set", () => {
    process.env.ANTHROPIC_MODEL_DEFAULT = HAIKU_4_5;
    expect(modelFor("ASK")).toEqual({ model: HAIKU_4_5, source: "default-env" });
  });

  it("does not let one feature's env var move another's", () => {
    process.env[modelEnvVar("PLAN_INGESTION")] = HAIKU_4_5;
    expect(modelFor("ASK").model).toBe(OPUS_5);
  });
});

describe("a bad override is ignored, never passed through", () => {
  it("falls back when a company override names an unknown model", () => {
    const choice = modelFor("ASK", "claude-opus-4-1-turbo-max");
    expect(choice.model).toBe(OPUS_5);
    // The source says the override did not win, which is what lets a log line
    // report that it was ignored rather than silently obeying it.
    expect(choice.source).toBe("feature-default");
  });

  it("falls back when an env var names an unknown model", () => {
    process.env[modelEnvVar("ASK")] = "gpt-4";
    expect(modelFor("ASK")).toEqual({ model: OPUS_5, source: "feature-default" });
  });

  it("ignores a date-suffixed id, which is the most likely typo", () => {
    expect(modelFor("ASK", "claude-opus-5-20260101").model).toBe(OPUS_5);
  });

  it("ignores blanks and whitespace rather than treating them as a choice", () => {
    process.env[modelEnvVar("ASK")] = "   ";
    expect(modelFor("ASK", "").model).toBe(OPUS_5);
    expect(modelFor("ASK", null).model).toBe(OPUS_5);
  });

  it("trims a pasted override rather than refusing it", () => {
    expect(modelFor("ASK", `  ${HAIKU_4_5}\n`).model).toBe(HAIKU_4_5);
  });
});

describe("client options", () => {
  it("sets the timeout in MILLISECONDS", () => {
    // The TypeScript SDK takes ms where Python takes seconds. A `120` here
    // would be 120ms and would fail every call — this asserts the magnitude,
    // not the value, so a future change cannot quietly slip a unit.
    expect(AI_CLIENT_OPTIONS.timeout).toBeGreaterThan(10_000);
    expect(AI_CLIENT_OPTIONS.timeout).toBe(120_000);
  });

  it("retries more than the SDK's default of two", () => {
    // Retries were never missing — the SDK already did two. This is the
    // explicit, reviewable setting, which is the thing that was missing.
    expect(AI_CLIENT_OPTIONS.maxRetries).toBeGreaterThan(2);
  });

  it("keeps worst-case wall clock under ten minutes", () => {
    // `timeout × (maxRetries + 1)` is the real ceiling, and it is why the
    // timeout came down from the SDK's ten-minute default when retries went up.
    expect(AI_CLIENT_OPTIONS.timeout * (AI_CLIENT_OPTIONS.maxRetries + 1)).toBeLessThanOrEqual(10 * 60 * 1000);
  });
});

describe("the feature list", () => {
  it("names every feature exactly once", () => {
    expect(new Set(AI_FEATURE_NAMES).size).toBe(AI_FEATURE_NAMES.length);
  });

  it("uses the same strings AskUsage.feature already records", () => {
    // These six are in production rows today. Renaming one would orphan the
    // history rather than move it, so they are pinned by value.
    expect(AI_FEATURES.ASK).toBe("ask");
    expect(AI_FEATURES.WIP_NARRATIVE).toBe("wip-narrative");
    expect(AI_FEATURES.COMPLIANCE_EXTRACT).toBe("compliance-extract");
    expect(AI_FEATURES.DRAFT_ESTIMATE_LINES).toBe("draft-estimate-lines");
    expect(AI_FEATURES.BID_RESEARCH).toBe("bid-research");
    expect(AI_FEATURES.LEAD_SEARCH).toBe("lead-search");
  });
});
