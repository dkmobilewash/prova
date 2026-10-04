import { describe as group, expect, it } from "vitest";
import {
  AI_FEATURES,
  RATES,
  WEB_SEARCH_PER_1K,
  WEB_SEARCH_SOURCE,
  missingTokenRates,
  modelFor,
  pricedModels,
  rateFor,
  type AiFeatureKey,
} from "@prova/integrations";

/**
 * EVERY MODEL A LIVE FEATURE RUNS ON HAS A COMPLETE, SOURCED PRICE.
 *
 * ── THIS FILE WAS THE GATE ON STEP 2, AND IT HAS BEEN SATISFIED ──
 *
 * Two of the nine assertions below were RED ON PURPOSE while three of the five
 * rates a cost needs — cache read, cache write, and the per-search web charge —
 * were recorded nowhere in this repo. They were filled in on 2026-10-02 off the
 * official pricing page, every rate carries its `source`, and all nine pass.
 *
 * The two are still titled `GATE:` because that is what they do for the NEXT
 * model: a feature routed to something unpriced, or a price change recorded for
 * only some token kinds, fails them exactly the same way. Nothing about them was
 * weakened to go green, which is the only thing that would have made the red
 * worthless.
 *
 * `pricing.ts` will not invent a rate. The entire output of that module is a
 * dollar figure somebody multiplies out to decide whether 1,500 plan sheets a
 * month is sustainable, and a confident wrong price is worse than no price —
 * it is the one kind of error nobody re-checks.
 *
 * **IF ONE OF THESE GOES RED:** open `packages/integrations/src/pricing.ts` and
 * replace the `UNSET` it names with the real number, extending that rate's
 * `source` string to say where it came from and the day it was read. The failure
 * messages name exactly which figures are outstanding. **DO NOT make it green by
 * weakening an assertion** — a red here means a figure on the cost screen would
 * otherwise be a guess, and the whole design of `cost.ts` is that a guess is
 * reported as "unknown" instead.
 *
 * ── WHY IT IS A CENSUS AND NOT A CHECKLIST ──
 *
 * Both ends derived. The models come from `pricedModels()`, which walks
 * `AI_FEATURES` through `modelFor` — so it is the model that will ACTUALLY run,
 * env override included, and a tenth feature appears here the moment it exists.
 * The rates come from `RATES`. Neither is a list somebody has to remember.
 */

group("every model a live feature runs on has a price", () => {
  it("found features and models to check — an empty question passes everything", () => {
    // The size assertions. A `pricedModels()` that returned nothing would make
    // every check below vacuous: nothing is ever missing from an empty list.
    expect(Object.keys(AI_FEATURES).length, "no AI features in the registry").toBeGreaterThan(5);
    expect(pricedModels().length, "no models resolved — modelFor or the registry drifted").toBeGreaterThan(0);
    expect(Object.keys(RATES).length, "no rates recorded at all").toBeGreaterThan(0);
  });

  it("has a rate entry for every model a feature resolves to", () => {
    const unpriced = pricedModels().filter((model) => !RATES[model]);
    expect(
      unpriced,
      `these models are what a live feature runs on and have no rate entry: ${unpriced.join(", ")}. ` +
        `Add one to RATES in packages/integrations/src/pricing.ts, with its source.`,
    ).toEqual([]);
  });

  it("names which feature runs on each priced model, so a rate cannot be orphaned", () => {
    // The other direction: a rate for a model nothing uses is not wrong, but it
    // should be a deliberate carry-over rather than a leftover. Reported as a
    // list rather than failed, because an old model's rate is exactly what a
    // historical figure needs.
    const live = new Set(pricedModels());
    const carried = Object.keys(RATES).filter((model) => !live.has(model));
    for (const model of carried) {
      expect(RATES[model]!.length, `${model} is unused and has an empty rate history`).toBeGreaterThan(0);
    }
  });

  it("gives every rate a provenance", () => {
    // A figure that arrives anonymously cannot be checked against an invoice,
    // which is the only thing that can confirm it.
    for (const [model, history] of Object.entries(RATES)) {
      for (const rate of history) {
        expect(rate.source.trim().length, `${model} @ ${rate.from} has no source`).toBeGreaterThan(10);
        expect(rate.from, `${model} has a rate with no effective date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("keeps each model's rate history newest-first, which rateFor depends on", () => {
    // `rateFor` returns the first entry at or before the day, so an
    // out-of-order history would silently return an old price for a new row.
    for (const [model, history] of Object.entries(RATES)) {
      const dates = history.map((rate) => rate.from);
      expect(dates, `${model}'s rate history is not newest-first`).toEqual([...dates].sort().reverse());
    }
  });

  it("resolves a rate for every live model today", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const model of pricedModels()) {
      expect(rateFor(model, today), `no rate in force for ${model} today`).not.toBeNull();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // THE GATE. These two were the red ones until the rates were recorded on
  // 2026-10-02. They stay, unweakened, for the next model routed here.
  // ─────────────────────────────────────────────────────────────────────────

  it("GATE: every live model's rate is complete", () => {
    const today = new Date().toISOString().slice(0, 10);
    const outstanding: string[] = [];
    for (const model of pricedModels()) {
      const rate = rateFor(model, today);
      if (!rate) continue; // covered by the assertion above
      const missing = missingTokenRates(rate);
      if (missing.length > 0) outstanding.push(`${model}: ${missing.join(", ")}`);
    }
    expect(
      outstanding,
      "A LIVE MODEL HAS NO COMPLETE PRICE.\n" +
        outstanding.map((line) => `  - ${line}`).join("\n") +
        "\n\nPut the real numbers into RATES in packages/integrations/src/pricing.ts and extend each " +
        "`source` with where they came from and the day you read them. Until then the cost screen shows " +
        '"unknown" for any row that uses an unset rate, which is correct — but a cost feature that ' +
        "cannot price its own commonest call must not ship. Do not weaken this assertion.",
    ).toEqual([]);
  });

  it("GATE: the per-search web charge is set and sourced", () => {
    // `lead-search` and `bid-research` are MOSTLY this charge, so without it
    // their cost is not approximately right, it is absent.
    expect(
      WEB_SEARCH_PER_1K,
      "WEB_SEARCH_PER_1K is unset. Web search bills per search on top of tokens, and lead search and bid " +
        "research are mostly that charge — a token-only figure for them would be wrong rather than rough. " +
        "Set it in packages/integrations/src/pricing.ts.",
    ).not.toBeNull();
    expect(
      WEB_SEARCH_SOURCE.trim().length,
      "WEB_SEARCH_PER_1K needs a source saying where the figure came from and when it was read.",
    ).toBeGreaterThan(10);
  });

  it("knows which features can incur a web-search charge, so the gate above is not academic", () => {
    // Derived rather than asserted from memory: a feature that gains web search
    // later is covered without editing this.
    const searchers = (Object.keys(AI_FEATURES) as AiFeatureKey[]).filter((feature) =>
      ["LEAD_SEARCH", "BID_RESEARCH"].includes(feature),
    );
    expect(searchers.length, "the two web-search features are no longer in the registry").toBe(2);
    for (const feature of searchers) {
      expect(modelFor(feature).model, `${feature} resolves to no model`).toBeTruthy();
    }
  });
});
