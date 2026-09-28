import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "./aiFeatureGateCensus.test";

/**
 * A VERSIONED PROMPT'S USAGE ROWS MUST CARRY THE VERSION.
 *
 * `docs/ai/DECISIONS.md` asked for exactly this file, and its reasoning is why the
 * census exists rather than a note:
 *
 *   "`promptVersion` has no writer, and forgetting THAT is silent… A missing cap
 *    shouts; a missing prompt version does not — rows accumulate with `null`,
 *    nothing breaks, and the first time somebody claims a prompt change made
 *    anything better, the rows cannot be attributed to either version. That is
 *    this repo's most expensive recurring shape. So the guard is built WITH the
 *    first prompt file, not after it… A note in this file is not sufficient and
 *    saying so here is not a contradiction — CLAUDE.md's own lesson is that
 *    'nobody has fixed X' is a claim with an expiry date, and this paragraph is
 *    one. The test is what outlives it."
 *
 * `plan-ingestion` is that first prompt file. This is that test.
 *
 * BOTH ENDS ARE DERIVED, which is the shape every census here has had to learn.
 * The versioned features come out of `packages/integrations` — a file that declares
 * a `*_PROMPT_VERSION` and resolves a feature with `modelFor(...)` has a versioned
 * prompt for that feature. The recording sites come out of the app. Neither is a
 * list somebody has to remember to update, because a list somebody has to remember
 * is the thing this file is guarding against.
 *
 * AND THE SIZE OF EACH SET IS ASSERTED, because a pattern that matches nothing
 * passes every downstream check: nothing is ever missing from an empty list. That
 * is #224's scar — a guard went green on 180 foreign keys when the answer was 181 —
 * and #265's, where the offending file was outside the directory being walked.
 */

const INTEGRATIONS = fileURLToPath(new URL("../../../../packages/integrations/src/", import.meta.url));
const APP = fileURLToPath(new URL("../../", import.meta.url));

/**
 * IMPORTED, NOT COPIED, and the first version of this file did copy it.
 *
 * A naive `(^|[^:])//…` strip protects `https://` — the character before the slashes
 * is a colon — and then eats the SECOND pair in `https://example.com/a//b`, because
 * an `a` precedes those. The test at the bottom caught it on the first run.
 * `aiFeatureGateCensus` already solved this properly and exports its stripper for
 * exactly this reason; a second copy here would be two implementations of one rule,
 * which is how one of them stops being true.
 */
const withoutComments = stripComments;

function filesUnder(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) filesUnder(full, ext, out);
    else if (ext.test(name)) out.push(full);
  }
  return out;
}

/** `export const X_PROMPT_VERSION = "…"` */
const VERSION_CONST = /export\s+const\s+([A-Z0-9_]*PROMPT_VERSION)\s*(?::[^=]+)?=\s*["'`]([^"'`]+)["'`]/g;
/** `modelFor("PLAN_INGESTION")` */
const MODEL_FOR = /modelFor\(\s*["']([A-Z0-9_]+)["']\s*\)/g;

/** The enum member as the usage ledger spells it: PLAN_INGESTION -> plan-ingestion. */
function usageFeature(enumMember: string): string {
  return enumMember.toLowerCase().replace(/_/g, "-");
}

/** Features whose prompt carries a version, derived from the integrations package. */
function versionedFeatures(): { feature: string; constant: string; version: string; file: string }[] {
  const found: { feature: string; constant: string; version: string; file: string }[] = [];
  for (const path of filesUnder(INTEGRATIONS, /\.ts$/)) {
    const code = withoutComments(readFileSync(path, "utf8"));
    const versions = [...code.matchAll(VERSION_CONST)];
    if (versions.length === 0) continue;
    const features = [...code.matchAll(MODEL_FOR)].map((match) => match[1]!);
    // A file with a version constant and no `modelFor` is a real mistake rather
    // than a case to skip: the version could never be attributed to a feature.
    expect(
      features.length,
      `${path.replace(INTEGRATIONS, "")} declares a prompt version but resolves no feature with modelFor(…), ` +
        "so nothing could attribute a usage row to it",
    ).toBeGreaterThan(0);
    for (const version of versions) {
      for (const feature of features) {
        found.push({
          feature: usageFeature(feature),
          constant: version[1]!,
          version: version[2]!,
          file: path.replace(INTEGRATIONS, ""),
        });
      }
    }
  }
  return found;
}

/**
 * Every object in the app that DECLARES a usage feature, and whether it carries a
 * prompt version.
 *
 * ANCHORED ON THE DATA, NOT ON THE FUNCTION NAME, and the first version of this
 * file got that wrong in a way only a mutation revealed. It searched for
 * `recordAskUsage(` — and `lib/plan-ingest/titleBlock.ts` injects its ports so it
 * can be tested without a database, so the call there reads `deps.recordUsage(…)`.
 * Removing `promptVersion` from that call left this census GREEN. A guard for one
 * specific silent defect, blind to that defect at its only call site, is worse than
 * no guard at all: it would have been cited as evidence.
 *
 * `feature: "plan-ingestion"` is the thing that cannot be renamed away, because the
 * ledger's own column holds that string and `AskUsageFeature` is a closed union. So
 * this finds those declarations wherever they are written and walks out to the
 * enclosing object literal — through a wrapper, a helper, an injected dep, or a
 * call shape nobody has thought of yet.
 */
function usageRecords(): { file: string; feature: string; carriesVersion: boolean }[] {
  const records: { file: string; feature: string; carriesVersion: boolean }[] = [];
  const FEATURE_KEY = /feature:\s*["']([a-z][a-z0-9-]*)["']/g;

  for (const path of filesUnder(APP, /\.tsx?$/)) {
    if (/\.(test|dbtest)\.tsx?$/.test(path)) continue;
    const code = withoutComments(readFileSync(path, "utf8"));
    for (const match of [...code.matchAll(FEATURE_KEY)]) {
      // Walk BACK to this object literal's own `{`, counting depth so a nested
      // object closed between here and it cannot be mistaken for the opener.
      let depth = 0;
      let open = -1;
      for (let i = match.index! - 1; i >= 0; i--) {
        if (code[i] === "}") depth += 1;
        else if (code[i] === "{") {
          if (depth === 0) {
            open = i;
            break;
          }
          depth -= 1;
        }
      }
      if (open === -1) continue;
      // Then forward to its match.
      depth = 0;
      let close = code.length;
      for (let i = open; i < code.length; i++) {
        if (code[i] === "{") depth += 1;
        else if (code[i] === "}") {
          depth -= 1;
          if (depth === 0) {
            close = i;
            break;
          }
        }
      }
      records.push({
        file: path.replace(APP, ""),
        feature: match[1]!,
        carriesVersion: /promptVersion:/.test(code.slice(open, close)),
      });
    }
  }
  return records;
}

describe("a versioned prompt's usage rows carry the version", () => {
  const versioned = versionedFeatures();
  const records = usageRecords();

  it("found both sets at all — an empty question passes everything below", () => {
    // THE SIZE ASSERTIONS, first, and they are not decoration. A pattern that
    // stops matching makes every check under it vacuous: nothing is missing from
    // an empty list, and nothing is ungated in a set with no members.
    expect(versioned.length, "no prompt version constants found in packages/integrations — the pattern drifted").
      toBeGreaterThan(0);
    expect(records.length, 'no usage records found in the app — the feature: "…" pattern drifted').toBeGreaterThan(0);
    // And the one this file was written for is present by name, so a rename that
    // silently empties the set is caught rather than passing.
    expect(versioned.map((one) => one.feature)).toContain("plan-ingestion");
  });

  it("gives every versioned prompt a version that looks like one", () => {
    for (const one of versioned) {
      // `name.N` — a bare number could not say which prompt moved, and a bare
      // name could not say that it moved at all.
      expect(one.version, `${one.constant} in ${one.file}`).toMatch(/^[a-z0-9-]+\.\d+$/);
    }
  });

  it("RECORDS THE VERSION wherever a versioned feature's usage is written", () => {
    const features = new Set(versioned.map((one) => one.feature));
    const missing = records
      .filter((record) => features.has(record.feature) && !record.carriesVersion)
      .map((record) => `${record.file} records ${record.feature} without promptVersion`);
    expect(
      missing,
      "a usage row for a feature whose prompt is versioned must carry that version, or a later claim that a " +
        "prompt change improved anything cannot be attributed to either version — docs/ai/DECISIONS.md",
    ).toEqual([]);
  });

  it("reads a whole argument object, not up to the first bracket", () => {
    // The parser's own test, because a balanced-paren walk is exactly the kind of
    // thing that looks right and truncates: `usage` is a nested object and
    // `promptVersion` sits after it at several call sites.
    const sample = 'recordAskUsage({ feature: "x", usage: { inputTokens: f(1) }, promptVersion: V });';
    const code = withoutComments(sample);
    let depth = 0;
    let end = 0;
    const start = code.indexOf("recordAskUsage(");
    for (let i = code.indexOf("(", start); i < code.length; i++) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const args = code.slice(start, end);
    expect(args).toContain("promptVersion:");
    expect(/feature:\s*["']([a-z0-9-]+)["']/.exec(args)?.[1]).toBe("x");
  });

  it("uses a stripper that survives a URL — the import, verified rather than assumed", () => {
    // Not a duplicate of the gate census's own test for this. That one proves the
    // stripper is correct; this one proves THIS FILE GOT THAT ONE rather than a
    // naive local copy, which is what it had until the assertion failed.
    const out = withoutComments(
      ['// recordAskUsage({ promptVersion: "x.1" })', 'const u = "https://example.com/a//b";'].join("\n"),
    );
    expect(out).not.toContain("recordAskUsage");
    expect(out).toContain("https://example.com/a//b");
  });
});
