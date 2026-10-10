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

  /**
   * THE EVALS THAT CALL NO MODEL, named rather than detected.
   *
   * This guard's real property is that **an eval must not pass on nothing**. For
   * an eval that calls a model, an API-key check at collection is how that is
   * guaranteed: without a key it refuses instead of scoring zero cases.
   *
   * `scaleAudit.eval.ts` calls no model. It is deterministic geometry over
   * drawings somebody points it at, so there is no key to demand and demanding
   * one would be theatre. It makes the SAME guarantee by other means, and the
   * loop below asserts both halves rather than taking the exemption on trust:
   * it SKIPS when given no input, and when given input it asserts the input
   * resolved to something before reading a figure off the run.
   *
   * Detecting "calls a model" was tried and rejected as the discriminator:
   * `@prova/integrations` is imported by eight of these files and NOT by the two
   * in this folder, which do call a model. A named exemption with its own
   * assertions is the pattern `clerkMountGate.test.ts` uses for `/sign-in` and
   * `/sign-up`, and for the same reason — an exemption nobody checks is a hole,
   * and one the guard re-proves is a second kind of guarantee.
   */
  const KEYLESS_EVALS: Record<string, string> = {
    "scaleAudit.eval.ts":
      "calls no model: deterministic geometry over real drawings, guarded by a skip plus a non-zero input assertion",
    "takeoffBench.eval.ts":
      "calls no model: generated drawings through the real scale/wall/schedule pipeline, guarded by a skip plus non-zero case and path-operator assertions",
  };

  it("NAMES EVERY KEYLESS EXEMPTION, and each one still exists", () => {
    // An exemption for a file that has been renamed or deleted is a hole left
    // open for whatever lands on that name next.
    for (const name of Object.keys(KEYLESS_EVALS)) {
      expect(
        files.some((file) => file.endsWith(name)),
        `${name} is exempted from the key check but no such eval exists any more — remove the exemption`,
      ).toBe(true);
    }
  });

  it("holds the keyless evals to the SAME promise by other means", () => {
    for (const name of Object.keys(KEYLESS_EVALS)) {
      const file = files.find((f) => f.endsWith(name));
      if (file === undefined) continue;
      const source = readFileSync(file, "utf8");

      // It must refuse to run on nothing rather than scoring a clean zero.
      expect(
        /describe\.skipIf\(/.test(source),
        `${name} is exempt from the key check but does not skip when it has no input — so with nothing ` +
          `set it would run and pass on nothing, which is the whole thing this guard exists to refuse`,
      ).toBe(true);

      // And when it IS given input, it must prove the input resolved to
      // something before reading any figure off the run. A mistyped folder name
      // otherwise produces no pages, no findings and a clean summary.
      expect(
        /expect\([^)]*\.length[\s\S]{0,200}?toBeGreaterThan\(0\)/.test(source),
        `${name} never asserts its input resolved to anything, so a path that matches no file would ` +
          `read as a clean run`,
      ).toBe(true);
    }
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
      // The keyless evals are held to the same promise two cases above, by the
      // means they actually have. See `KEYLESS_EVALS`.
      if (Object.keys(KEYLESS_EVALS).some((exempt) => name.endsWith(exempt))) continue;

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
