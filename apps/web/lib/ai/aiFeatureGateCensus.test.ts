import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AI_FEATURE_KEYS } from "./settings";
import type { AiFeatureKey } from "@prova/integrations/src/models";

/**
 * EVERY MODEL CALL IN THIS APP IS BEHIND THE PER-COMPANY AI SWITCH — the fact,
 * not the intention.
 *
 * Diego's requirement for the AI work is one sentence: "Put every AI feature
 * behind a per-organization setting so it can be switched off." A contractor's
 * plan sets, specs and quotes are confidential, and a switch that covers five
 * of six callers is not a switch — it is a setting that makes a promise the
 * product does not keep, which is worse than having no setting at all, because
 * somebody relies on it.
 *
 * `lib/ai/settings.ts` is the gate. This file is what makes it unskippable:
 * add a seventh model caller with no `aiGate` in front of it and the build
 * fails naming the file.
 *
 * WHAT IT DERIVES, AND WHY BOTH ENDS ARE DERIVED RATHER THAN LISTED. This repo
 * has paid for a census twice, in two different ways, and this file is built
 * against both scars:
 *
 *   - `scratch-cleanup-order.test.ts` (#224) had the right SCOPE and a pattern
 *     one line-break from matching nothing, and it went green on a set of 180
 *     where the answer was 181. So every set parsed here has its SIZE asserted
 *     against something that cannot drift with the pattern that found it: a
 *     model call that resolves to no feature FAILS, rather than quietly
 *     leaving the set.
 *   - `theme-contrast.test.ts` (#265) had the right pattern and the wrong
 *     SCOPE — it resolved its root to `apps/web` and the one offending file in
 *     the repo was in `packages/ui`, so no size assertion could ever have
 *     helped. Nothing is ever missing from a directory you do not walk. So the
 *     list of model callers here is read out of `packages/integrations`, which
 *     is where a model call has to be written, rather than out of a list in
 *     this file that a new caller would not appear in.
 *
 * AND COMMENTS ARE STRIPPED, which is not tidiness either. `document-uploads.ts`
 * and `ask/commands/leads.ts` both NAME a model caller in prose —
 * "`extractComplianceDocument` hands the bytes to Anthropic",
 * "`findLeads` has already dropped" — so a raw-text census would demand a gate
 * in two files that make no model call, and #185's own scar is the mirror of
 * it: a census disarmed by a comment quoting its own pattern.
 */

const HERE = new URL(".", import.meta.url).pathname;
const REPO = join(HERE, "..", "..", "..", "..");
const PACKAGE_SRC = join(REPO, "packages", "integrations", "src");
const APP = join(REPO, "apps", "web");

/**
 * Comments out, string contents kept.
 *
 * A regex would do this wrong in a way that matters: `"https://..."` contains
 * `//`, and cutting from there to end of line would delete the rest of a real
 * line of code — which fails OPEN, since less text means fewer matches means a
 * smaller set means nothing missing. So this walks characters and tracks which
 * of the five states it is in. Proved against a fixture at the bottom of this
 * file rather than assumed.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < source.length && source.slice(i, i + 2) !== "*/") i += 1;
      i += 2;
      continue;
    }
    const quote = source[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      out += quote;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/** Every `.ts` under a directory, recursively, tests excluded. */
function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.(test|dbtest|eval)\.tsx?$/.test(entry.name)) continue;
      found.push(path);
    }
  };
  walk(root);
  return found;
}

/** One place in `packages/integrations` that asks Anthropic to generate. */
type ModelCall = {
  file: string;
  /** The exported function it sits inside — what an app file imports. */
  fn: string;
  /** The feature key its `model:` resolves to. */
  feature: AiFeatureKey;
};

/**
 * The model calls, read out of the package.
 *
 * `messages.create` and `messages.stream` are the only two ways this app asks
 * for a generation, and every one of them has a `model:` in the same object
 * literal. `models.retrieve` is deliberately NOT in the pattern:
 * `checkAnthropicConnection` uses it for the Check-connection button on
 * /settings/assistant, which generates nothing, costs nothing and has to keep
 * working precisely so an owner can diagnose a switched-off or misconfigured
 * assistant.
 */
function modelCalls(): { calls: ModelCall[]; siteCount: number; fileCount: number } {
  const files = sourceFiles(PACKAGE_SRC);
  const calls: ModelCall[] = [];
  let siteCount = 0;

  for (const file of files) {
    const code = stripComments(readFileSync(file, "utf8"));
    const sites = [...code.matchAll(/\.messages\.(?:create|stream)\s*\(/g)];
    siteCount += sites.length;

    for (const site of sites) {
      const at = site.index ?? 0;
      // The feature comes from the `model:` property of this very call. Two
      // spellings reach it: `modelFor("X")` directly, or `DEFAULT_MODEL`,
      // which ask.ts defines as `modelFor("ASK").model` — the Ask loop's own
      // indirection, and the reason this is not a single pattern.
      const body = code.slice(at, at + 400);
      const direct = body.match(/model:[^,\n]*modelFor\(\s*"([A-Z_]+)"/);
      const viaDefault = /model:[^,\n]*\bDEFAULT_MODEL\b/.test(body);
      const feature = direct ? direct[1] : viaDefault ? askDefaultFeature(code) : null;

      // Walk back to the nearest enclosing export. `export async function*`
      // is one of the four shapes here — `streamToolConversation` is a
      // generator — so the pattern admits the star or it silently attributes
      // the Ask loop to whatever was declared above it.
      const before = code.slice(0, at);
      const names = [...before.matchAll(/export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_]+)\s*(?:<|\()/g)];
      const fn = names.length > 0 ? names[names.length - 1][1] : null;

      // A site that resolves to nothing is the failure this whole file is
      // built around: it must not drop out of the set. It is pushed with a
      // marker so the size assertion below catches it and NAMES it, rather
      // than the set quietly being one short.
      calls.push({
        file: file.slice(REPO.length + 1),
        fn: fn ?? "UNRESOLVED_FUNCTION",
        feature: (feature ?? "UNRESOLVED_FEATURE") as AiFeatureKey,
      });
    }
  }
  return { calls, siteCount, fileCount: files.length };
}

/** What `DEFAULT_MODEL` resolves to in ask.ts — read, not assumed. */
function askDefaultFeature(code: string): string | null {
  const match = code.match(/ASK_DEFAULT_MODEL\s*=\s*modelFor\(\s*"([A-Z_]+)"/);
  return match ? match[1] : null;
}

/**
 * THE ONE EXEMPTION, named here rather than left to a reader to notice.
 *
 * `lib/ask/eval/harness.ts` imports `streamToolConversation` and calls it for
 * real. It is the offline routing eval's grader: it is imported only by
 * `*.eval.ts` suites, it runs from a developer's terminal against a key it
 * demands up front (`requireApiKey`, which throws rather than skipping), and
 * there is no company anywhere in it to read a setting for. Gating it would
 * mean inventing a company id in order to ask that company's permission to
 * run our own eval.
 *
 * The exemption is asserted, not asserted-to-be-fine: the test below requires
 * this file to still be the eval harness — no company context, and still
 * calling `requireApiKey` — so it cannot quietly become a path a customer
 * reaches.
 */
const GATE_EXEMPT = "lib/ask/eval/harness.ts";

describe("every AI feature is behind the per-company switch", () => {
  const { calls, siteCount, fileCount } = modelCalls();

  it("parsed the package at all — a scope that walks nothing can never be missing anything", () => {
    expect(fileCount).toBeGreaterThanOrEqual(5);
    expect(siteCount).toBeGreaterThanOrEqual(5);
    // Every site found became a call in the set. The equality is the point:
    // it is what a pattern that stopped matching, or an enclosing function it
    // could not name, fails on.
    expect(calls).toHaveLength(siteCount);
  });

  it("attributes every model call to a feature and to an exported function", () => {
    // Named rather than counted, because "one of them is unresolved" is not
    // something anybody can act on.
    const unresolved = calls.filter(
      (call) => call.feature === ("UNRESOLVED_FEATURE" as AiFeatureKey) || call.fn === "UNRESOLVED_FUNCTION",
    );
    expect(unresolved).toEqual([]);
  });

  it("uses only features the switch knows about", () => {
    for (const call of calls) {
      // A model call whose feature has no enum member could never be switched
      // off, and would read as switched off on the settings page — the
      // free-text-versus-enum argument `ai-settings.prisma` makes.
      expect(AI_FEATURE_KEYS, `${call.file} calls the model as "${call.feature}"`).toContain(call.feature);
    }
  });

  /**
   * THE ASSERTION THIS FILE EXISTS FOR.
   *
   * For each model-calling function, every app file that imports it must gate
   * the matching feature. Comments stripped, so naming a caller in prose is
   * not a claim about what the file does.
   */
  it("gates every app-side caller of every model-calling function", () => {
    const appFiles = sourceFiles(APP).map((file) => ({
      path: file.slice(APP.length + 1),
      code: stripComments(readFileSync(file, "utf8")),
    }));

    const byFn = new Map<string, AiFeatureKey>();
    for (const call of calls) byFn.set(call.fn, call.feature);

    type Verdict = { file: string; fn: string; feature: string; gated: boolean; exempt: boolean };
    const verdicts: Verdict[] = [];

    for (const [fn, feature] of byFn) {
      // An IMPORT of the function, not a mention of it — the import is what
      // makes a file able to spend money.
      const imports = new RegExp(`import[^;]*\\b${fn}\\b[^;]*from\\s*"@prova/integrations"`, "s");
      for (const file of appFiles) {
        if (!imports.test(file.code)) continue;
        const gated = new RegExp(`aiGate\\(\\s*[^)]*"${feature}"`).test(file.code);
        verdicts.push({ file: file.path, fn, feature, gated, exempt: file.path === GATE_EXEMPT });
      }
    }

    // ABSENCE OF A FAILURE IS NOT A PASS (CLAUDE.md, and #195's "0 confirmed,
    // 10 refuted" where every verifier had died). An empty verdict list would
    // satisfy every assertion below, so the count is asserted first: each of
    // the model-calling functions must have been looked for, and found.
    expect(byFn.size).toBeGreaterThanOrEqual(5);
    expect(verdicts.length).toBeGreaterThanOrEqual(byFn.size);
    for (const fn of byFn.keys()) {
      expect(
        verdicts.filter((verdict) => verdict.fn === fn && !verdict.exempt),
        `nothing in apps/web imports ${fn} — either it is dead, or this census stopped finding its callers`,
      ).not.toEqual([]);
    }

    const ungated = verdicts.filter((verdict) => !verdict.gated && !verdict.exempt);
    expect(
      ungated.map((verdict) => `${verdict.file} calls ${verdict.fn} without aiGate(…, "${verdict.feature}")`),
    ).toEqual([]);
  });

  it("keeps the one exemption an offline eval harness", () => {
    const code = stripComments(readFileSync(join(APP, GATE_EXEMPT), "utf8"));
    // Still the eval's own grader: it demands a key of its caller, and knows
    // nothing about a company. Either of these changing means it has become
    // something a customer can reach, and the exemption has to be revisited
    // rather than inherited.
    expect(code).toContain("requireApiKey");
    expect(code).not.toContain("requireCompanyContext");
    expect(code).not.toContain("companyId");
  });

  it("covers every feature the switch offers, and says which one is not built", () => {
    const covered = new Set(calls.map((call) => call.feature));
    // PLAN_INGESTION is in the enum and has no model call yet: the switch was
    // added BEFORE the feature so it cannot be retrofitted onto call sites
    // afterwards, which is how the other six came to need this census. When
    // ingestion lands, it joins `covered` and this list goes empty — and if
    // somebody ships it ungated, the assertion above is what fails.
    const notBuilt: AiFeatureKey[] = ["PLAN_INGESTION"];
    const missing = AI_FEATURE_KEYS.filter((key) => !covered.has(key) && !notBuilt.includes(key));
    expect(missing).toEqual([]);
    for (const key of notBuilt) expect(covered.has(key)).toBe(false);
  });
});

describe("the comment stripper this census rests on", () => {
  it("removes comments and keeps string contents, including a URL's slashes", () => {
    const source = [
      '// aiGate(companyId, "ASK")',
      "const url = \"https://example.com/a//b\";",
      "/* aiGate(companyId, \"ASK\") */",
      "const kept = `a ${b} // c`;",
      'const real = aiGate(companyId, "ASK");',
    ].join("\n");
    const out = stripComments(source);
    // The two commented gates are gone; the real one and both strings survive
    // whole. This is the mutation test in miniature: a stripper that ate from
    // `//` inside the URL would drop the line, and a census over less text can
    // only ever find fewer things.
    expect(out).not.toContain('// aiGate');
    expect(out).toContain("https://example.com/a//b");
    expect(out).toContain("`a ${b} // c`");
    expect(out.match(/aiGate/g)).toHaveLength(1);
  });
});
