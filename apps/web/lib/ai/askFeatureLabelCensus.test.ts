import { readFileSync } from "node:fs";
import { describe as group, expect, it } from "vitest";
import { AI_FEATURE_LABEL, AI_FEATURE_KEYS, askFeatureLabel } from "./features";

/**
 * EVERY FEATURE THE USAGE LEDGER CAN WRITE HAS A NAME A PERSON WOULD READ.
 *
 * ── WHY THIS FILE EXISTS, AND WHY IT IS NOT THE OBVIOUS TEST ──
 *
 * The cost panel shipped on 2026-10-02 looking a feature's label up with the
 * LEDGER's spelling (`plan-ingestion`) in a map keyed by the SETTINGS spelling
 * (`PLAN_INGESTION`). That is `undefined` for every feature, and a `?? feature`
 * fallback rendered the raw database key on a money screen. Found by clicking
 * it. Nothing in 8,536 tests could have caught it, and two guards that already
 * existed looked like they covered it:
 *
 *   - `AI_FEATURE_LABEL` is a TOTAL `Record<AiFeatureKey, string>`, so a feature
 *     with no label does not compile. That assertion was TRUE and PASSING the
 *     whole time. It proves the map is COMPLETE; it cannot see a consumer
 *     reading it with the wrong key. The #526 shape — *nothing is ever missing
 *     from a list nobody imports* — arriving as *nothing is ever missing from a
 *     map nobody can index*.
 *   - the `as keyof typeof` cast at the call site, which silenced the exact type
 *     error that would have failed the build.
 *
 * So the question this file asks is the one neither of those asks: not "does
 * every key have a label" but **"does every string the ledger can actually
 * write resolve to one"** — which is a question about the TRANSLATION, and the
 * translation is where the defect lived.
 *
 * ── AND IT ASSERTS THE FALLBACK IS NEVER THE NORMAL PATH ──
 *
 * `askFeatureLabel` keeps its `?? ledgerFeature` fallback on purpose, so a tenth
 * caller that writes a row before anybody names it appears on a bill under its
 * own key rather than vanishing. That fallback is also precisely what disguised
 * the bug: a total failure wearing the clothes of a rare edge case. A guard that
 * tolerates it is no guard, so the test below requires the fallback to fire for
 * ZERO known features — if it ever fires for one, the label is the raw key again
 * and this fails naming it.
 */

/**
 * The ledger's own feature strings, parsed from the union that declares them
 * rather than retyped here. Retyping them would make this census a second
 * hand-kept list of exactly the kind it exists to catch — it would agree with
 * itself forever while `AskUsageFeature` grew a tenth member.
 */
function ledgerFeatures(): string[] {
  const source = readFileSync(new URL("../ask/usage.ts", import.meta.url), "utf8");
  const declaration = /export type AskUsageFeature =([\s\S]*?);\n/.exec(source);
  expect(
    declaration,
    "could not find `export type AskUsageFeature = …` in lib/ask/usage.ts — if that union moved or was " +
      "renamed, fix this pattern rather than deleting the census: an empty parse passes every assertion " +
      "below, because nothing is ever missing from an empty list.",
  ).not.toBeNull();

  // Comments stripped FIRST. Those doc comments quote feature names in prose
  // ("rather than folded into `compliance-extract`"), so a raw-text scan would
  // invent members that are not in the union — the #185 shape.
  const withoutComments = declaration![1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  return [...withoutComments.matchAll(/"([a-z][a-z-]*)"/g)].map((m) => m[1]);
}

group("every ledger feature resolves to a readable label", () => {
  const features = ledgerFeatures();

  it("parsed the union, and parsed a plausible number of members", () => {
    // THE SIZE ASSERTION, against a source that cannot drift with the pattern:
    // the ledger has one feature per switchable AI feature, so the two counts
    // must agree. A pattern that silently matched nothing would pass every
    // assertion after this one.
    expect(features.length).toBe(AI_FEATURE_KEYS.length);
    expect(features).toContain("ask");
    expect(features).toContain("plan-ingestion");
  });

  it("THE BUG: no feature renders its raw ledger key", () => {
    // The whole defect, in one assertion. Before the fix every one of these
    // failed; `ask` rendered as "ask" on a money screen.
    const raw = features.filter((feature) => askFeatureLabel(feature) === feature);
    expect(
      raw,
      "these features render their raw database key instead of a name — the fallback in " +
        "`askFeatureLabel` is firing for a KNOWN feature, which means the ledger spelling and " +
        "`AI_FEATURE_LABEL`'s keys have drifted apart again: " +
        raw.join(", "),
    ).toEqual([]);
  });

  it("every resolved label is one of the declared labels, not something invented", () => {
    // Guards the other direction: a transform that produced a plausible-looking
    // string by accident would pass the test above.
    const labels = new Set(Object.values(AI_FEATURE_LABEL));
    for (const feature of features) {
      expect(labels.has(askFeatureLabel(feature)), `${feature} resolved to a label nothing declares`).toBe(true);
    }
  });

  it("still names an unknown feature rather than dropping it", () => {
    // The fallback's real purpose, kept and proved. A row on a bill that
    // vanishes is worse than one with an ugly name.
    expect(askFeatureLabel("something-nobody-has-named")).toBe("something-nobody-has-named");
  });
});
