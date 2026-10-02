import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The guard on the guard.
 *
 * `requireApiKey()` is what stops an eval passing on nothing: without a
 * key, a run of zero cases and a run of a hundred look identical in a
 * terminal, and the first one reads as a clean bill. The failure mode of
 * that guard is not that it breaks — it is that the NEXT eval somebody
 * writes does not call it, which nothing would notice.
 *
 * So this walks the directory rather than a list. "Nothing is ever missing
 * from a directory you do not walk", and a list of eval files to check
 * would be a list somebody has to remember to add to, which is the same
 * bug one level up.
 *
 * ── AND IT WALKED THE WRONG DIRECTORY, WHICH IS THE DEFECT THE PARAGRAPH
 *    ABOVE INVOKES BY NAME ──
 *
 * Corrected 2026-10-02. `DIR` was `join(import.meta.dirname, ".")` — this
 * folder, `lib/ask/eval/`, which holds TWO of the repo's eval files. The other
 * six live beside the features they measure (`lib/estimating/`,
 * `lib/plan-ingest/`, `lib/quote-read/`, `lib/leads/`, `lib/research/`,
 * `lib/addenda/`) and were outside the walk entirely. All six happen to call
 * `requireApiKey()`, which is exactly why nobody noticed: the guard was green
 * and it was green about two files.
 *
 * This is `theme-contrast.test.ts` and `packages/ui/Button.tsx` again — right
 * pattern, wrong scope — and no size assertion can catch it, because a file
 * outside the walk is not a small set, it is not in the set at all. The comment
 * above makes it worse rather than better: it cites the rule it was breaking,
 * which is the shape that stops a reader looking.
 *
 * So the walk is now the whole of `lib/`, recursively, and the count is
 * asserted against the number of eval files that actually exist. A new eval
 * written anywhere under `lib/` is covered with no edit here.
 */
const LIB = join(import.meta.dirname, "..", "..");

function evalFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...evalFiles(full));
    else if (entry.name.endsWith(".eval.ts")) found.push(full);
  }
  return found;
}

describe("every eval refuses to run without a key", () => {
  const files = evalFiles(LIB);

  it("finds the eval files at all, across the WHOLE of lib", () => {
    // The size assertion. A pattern that matches nothing passes every
    // downstream check in the loop below, since nothing is ever missing
    // from an empty list — CLAUDE.md, the SQL guard that went green on 180
    // of 181 foreign keys.
    //
    // The floor is 8 rather than 2 deliberately: 2 was satisfiable by this
    // folder alone, so it could not have noticed the scope bug above. A floor
    // that the OLD scope cannot reach is what makes the fix stick.
    expect(files.length).toBeGreaterThanOrEqual(8);
    // And the walk must leave this folder, which is the specific thing that
    // was wrong. At least one eval outside `lib/ask/eval/`.
    expect(files.some((file) => !file.includes(join("ask", "eval")))).toBe(true);
  });

  it("demands a key BEFORE any case runs, not inside one", () => {
    // ── WHAT THIS ASSERTS, AND WHY IT IS NOT THE OLD REGEX ──
    //
    // The old assertion was `/^requireApiKey\(\);$/m` — column zero, that exact
    // name. Rescoping the walk to all of `lib/` showed it was wrong about six
    // legitimate files: they call `requireEvalApiKey(...)` (the SHARED helper,
    // which also rejects the "…" placeholder, so it is the better one) from the
    // `describe` body, which vitest runs at COLLECTION, before any case. That
    // satisfies the real requirement.
    //
    // So the property is stated directly instead of by position: the check is
    // reached at collection, and is NOT inside an `it`. Indentation is not the
    // thing that matters; whether a case has already started is.
    const INSIDE_IT = /\bit\(\s*[\s\S]{0,400}?require(Eval)?ApiKey\s*\(/;

    for (const name of files) {
      const source = readFileSync(name, "utf8");
      expect(
        /require(Eval)?ApiKey\s*\(/.test(source),
        `${name} never demands an API key, so without one it would pass on nothing`,
      ).toBe(true);

      // Reached at collection: either module scope, or inside a describe/group
      // body — both run before the first case.
      const atCollection =
        /^require(Eval)?ApiKey\(/m.test(source) || /^\s{2}require(Eval)?ApiKey\(/m.test(source);
      expect(
        atCollection,
        `${name} has a key check but not at collection scope. Put it at module scope or in the ` +
          `describe body — a check inside an \`it\` has already let the suite START, and a suite that ` +
          `starts and throws N times reads as a measurement that went badly rather than one that never ran.`,
      ).toBe(true);

      expect(
        INSIDE_IT.test(source),
        `${name} demands its key INSIDE an \`it\` body. See the message above: that is the one placement ` +
          `this guard exists to refuse.`,
      ).toBe(false);
    }
  });
});
