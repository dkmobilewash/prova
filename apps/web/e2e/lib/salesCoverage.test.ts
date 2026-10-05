import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERSONAS } from "./personas";

/**
 * THE GAP THAT LET `/sales` SHIP UNCLICKED, AS A TEST.
 *
 * On 2026-10-05 the entire cold-outbound acquisition channel — `/sales` and
 * `/sales/[id]` — had never been loaded by a browser in any test. The cause was
 * not negligence and is worth stating exactly, because it is the part that can
 * recur: both pages are gated on `Company.isProvaOperator`, no screen in this
 * product sets that flag, and no persona in this suite had it. So the pages were
 * unreachable BY CONSTRUCTION. `journey.spec.ts` step 10 walks every nav
 * destination the rail offers and still never reached them, because the rail
 * does not offer them to a company without the flag either. Thirty-odd specs,
 * 63 collected tests, and nothing in the repo said these two were missing.
 *
 * ── WHAT THIS CENSUS CAN AND CANNOT SEE, SAID FIRST ──
 *
 * It can see that a spec file NAMES the route and NAMES the persona. It cannot
 * see that the spec runs, that it passes, or that the page renders — a census
 * can tell you the code is there and can never tell you a framework honours it
 * (CLAUDE.md, the expo-router header entry). What answers "did it run" is
 * `e2e/collected.mjs` and `e2e/verdicts.mjs`, which require the number of
 * verdicts RETURNED to equal the number collected.
 *
 * So this is a guard against the specific failure that already happened: the
 * sales specs being deleted, renamed away, or quietly left pointing at nothing,
 * with every other check in the repo still green. That is exactly what was true
 * yesterday.
 *
 * ── HOW IT AVOIDS BEING GREEN ABOUT A DIRECTORY IT NEVER READ ──
 *
 * Two of this repo's three recurring census defects apply here and both are
 * guarded:
 *
 *   - SCOPE. The directory walked is not this file's own guess: it is read out
 *     of `playwright.config.ts`'s `testDir`, the same string the runner uses. A
 *     config that moves its specs makes this census follow, or fail saying the
 *     directory is not there — "nothing is ever missing from a directory you do
 *     not walk".
 *   - SIZE. Every file the walk returns must contain a Playwright `test(` call.
 *     A read that came back empty, a glob that matched a stray file, or a walk
 *     that silently shrank therefore fails loudly instead of passing every
 *     assertion downstream on an empty set.
 */

const here = __dirname;
const e2eRoot = path.resolve(here, "..");

/** `testDir`, read from the config rather than assumed, so the scanned set
 *  cannot drift away from the set Playwright runs. */
function configuredTestDir(): string {
  const config = readFileSync(path.join(e2eRoot, "playwright.config.ts"), "utf8");
  const match = /testDir:\s*"([^"]+)"/.exec(config);
  if (!match) {
    throw new Error(
      "e2e/playwright.config.ts no longer declares testDir as a plain string. " +
        "This census reads it from there on purpose — fix the pattern rather than hard-coding a path, " +
        "or it goes green about a directory nobody runs.",
    );
  }
  return path.resolve(e2eRoot, match[1]);
}

const specDir = configuredTestDir();
// Annotated rather than inferred, both of them. `readdirSync`'s own return type
// is enough in CI; in a container without `@types/node` it is `any`, and
// `new Map(entries)` then infers `Map<unknown, unknown>` and reports four errors
// that are about the environment rather than about this file. Explicit types
// make the typecheck answer the same question in both places.
const specFiles: string[] = readdirSync(specDir)
  .filter((name: string) => name.endsWith(".spec.ts"))
  .sort();
const sources = new Map<string, string>(
  specFiles.map((name: string): [string, string] => [
    name,
    readFileSync(path.join(specDir, name), "utf8"),
  ]),
);

describe("the census can see the specs at all", () => {
  it("walks the directory the Playwright config names", () => {
    expect(specDir.endsWith(`${path.sep}specs`), `testDir resolved to ${specDir}`).toBe(true);
  });

  it("found a real suite, not an empty set", () => {
    // A floor rather than an equality, deliberately: adding a spec must not
    // fail a build over a number. The per-file check below is what makes an
    // empty or garbled read fail instead of shrinking quietly.
    expect(specFiles.length).toBeGreaterThanOrEqual(20);
  });

  it("read every file it is about to reason over", () => {
    const empty = [...sources.entries()]
      .filter(([, source]) => !/\btest(?:\.describe)?\s*\(/.test(source))
      .map(([name]) => name);
    expect(empty, "these files are in testDir and declare no Playwright test").toEqual([]);
  });
});

describe("Prova's own sales screens are walked by a browser", () => {
  const mentions = (needle: string) =>
    [...sources.entries()].filter(([, source]) => source.includes(needle)).map(([name]) => name);

  it("has a persona whose company can reach them", () => {
    // Without this key there is nothing to sign in as, and both pages render a
    // refusal that is a perfectly healthy page — which is how this went
    // unnoticed. `seedDatabase.test.ts` is what pins that the persona's company
    // actually carries `isProvaOperator`.
    expect(Object.keys(PERSONAS)).toContain("sales");
  });

  it("navigates to /sales from at least one spec", () => {
    expect(mentions('page.goto("/sales")').length).toBeGreaterThanOrEqual(1);
  });

  it("signs in as the operator persona from at least one spec", () => {
    expect(mentions("PERSONAS.sales.email").length).toBeGreaterThanOrEqual(1);
  });

  it("reaches a lead's own page, not only the list", () => {
    // `/sales/[id]` is reached by CLICKING a lead, so its URL carries a cuid and
    // there is no literal path to grep for. What there IS, in any spec that gets
    // there honestly, is a wait on the URL it lands on — matched loosely on
    // purpose: a tighter pattern over a regex literal would fail the day
    // somebody reformats the spec, which is a census failing about itself.
    const reaching = [...sources.entries()]
      .filter(([, source]) => source.includes('page.goto("/sales")') && source.includes("waitForURL("))
      .map(([name]) => name);
    expect(
      reaching.length,
      "no spec that opens /sales then waits for another URL — the lead page is half of this feature",
    ).toBeGreaterThanOrEqual(1);
  });
});
