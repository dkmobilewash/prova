import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY screen a notification can cold-start must offer a way out.
 *
 * Written because #548 fixed ONE of them. A tap that launches the app from
 * a killed state leaves its destination alone on the stack — no back
 * chevron, because there is genuinely nothing behind it, and no tab bar if
 * the screen lives outside `(tabs)`. `/alerts` was the screen somebody
 * happened to be trapped on, so `/alerts` got a Home button. `/job/<id>`
 * is the OTHER destination `targetFromData` can return, it is also outside
 * `(tabs)`, and it had nothing — on the one push that reliably arrives
 * (`assignCrewMember`, which is not gated by the milestone ledger the
 * digest is).
 *
 * That is CLAUDE.md's "a guard that a list is complete cannot notice a
 * second list", one turn further out again: #548 was not even a guard, it
 * was a fix applied to the member of the set that had been observed. So
 * this file asks the only question that generalises — **not "is `/alerts`
 * fixed" but "is every destination fixed"** — and it derives the set of
 * destinations from the routing function rather than from a list kept here,
 * so adding a third push target extends the census with no edit to this
 * file.
 *
 * TWO assertions guard the derivation itself, because a check that derives
 * its input can be wrong in two ways and only one of them looks like a
 * failure:
 *
 *   - SIZE — the routes parsed must equal the routes counted by a second
 *     expression sharing no regex with the first. A pattern that silently
 *     stops matching otherwise passes everything downstream, since nothing
 *     is ever missing from an empty set.
 *   - SCOPE — every parsed route must resolve to a screen file that
 *     EXISTS. A route whose file cannot be found is not a small set, it is
 *     absent from the set, and no size assertion can see that.
 *
 * COMMENTS ARE STRIPPED BEFORE MATCHING, and that is load-bearing rather
 * than tidy: `job/[jobId].tsx` explains this defect in a comment that
 * quotes `canGoBack`, so a raw-text census would pass a screen that merely
 * TALKS about having an exit. #185's shape, and the version of it this repo
 * has paid for twice.
 */

const APP = join(__dirname, "..", "app");
const ROUTER = join(__dirname, "push-target.ts");

/** JS/TS comments removed, so a census cannot be satisfied by prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Every route `targetFromData` can return, read out of the function.
 *
 * Captures the VALUE of each string/template return whose content starts
 * with a slash — `return "/alerts"` and `` return `/job/${data.jobId}` ``.
 * `return null` yields nothing, which is correct: it means the tap opens
 * the app where it was, and there is no destination to strand anyone on.
 */
function pushDestinations(source: string): string[] {
  const found = [...source.matchAll(/return\s+(["'`])(\/[^"'`]*)\1/g)].map((m) => m[2]);
  return [...new Set(found)];
}

/**
 * The same count reached a different way, so the two cannot drift together.
 *
 * Counts LINES by a negative property — a `return` that is not `return
 * null` — rather than extracting a value. If the extractor's regex rots,
 * these two numbers diverge and the size test says so by name.
 */
function routeReturningLineCount(source: string): number {
  return source
    .split("\n")
    .filter((line) => /\breturn\b/.test(line) && !/\bnull\b/.test(line) && line.includes("/"))
    .length;
}

/**
 * The screen file a route renders, or null if none can be found.
 *
 * A segment containing `${` is an expo-router dynamic segment, which on
 * disk is a bracketed filename — `/job/${data.jobId}` is
 * `app/job/[jobId].tsx`. Matched by SHAPE rather than by the parameter's
 * name, so renaming `[jobId]` to `[id]` does not silently empty the set.
 */
function screenFileFor(route: string): string | null {
  const segments = route.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  let dir = APP;
  for (let i = 0; i < segments.length - 1; i++) {
    dir = join(dir, segments[i]);
  }
  if (!existsSync(dir)) return null;

  const last = segments[segments.length - 1];
  if (last.includes("${")) {
    const match = readdirSync(dir).find((name) => /^\[.+\]\.tsx$/.test(name));
    return match ? join(dir, match) : null;
  }
  const file = join(dir, `${last}.tsx`);
  return existsSync(file) ? file : null;
}

const routerSource = readFileSync(ROUTER, "utf8");
const destinations = pushDestinations(routerSource);

describe("every push destination has a way out of a cold start", () => {
  it("parses the same number of routes the router returns", () => {
    // The size assertion. Not decoration: a regex that matches nothing
    // passes every test below it, because nothing is missing from an empty
    // list and nothing is unfixed in it either.
    expect(
      destinations.length,
      "the route extractor and the line count disagree — one of the two patterns has drifted",
    ).toBe(routeReturningLineCount(routerSource));
  });

  it("finds more than one destination, so the census is not vacuous", () => {
    // If this ever drops to 1 the census has stopped being able to catch
    // the bug it was written for, which was precisely a SECOND destination.
    expect(destinations.length).toBeGreaterThan(1);
  });

  it("resolves every destination to a screen file that exists", () => {
    // The scope assertion. A route whose file cannot be found is not a
    // small set — it is not in the set, and the size test cannot see it.
    for (const route of destinations) {
      expect(screenFileFor(route), `no screen file on disk for push destination ${route}`).not.toBe(
        null,
      );
    }
  });

  it("gives every destination a Home button when nothing is behind it", () => {
    for (const route of destinations) {
      const file = screenFileFor(route);
      expect(file, `no screen file for ${route}`).not.toBe(null);
      const source = stripComments(readFileSync(file as string, "utf8"));

      expect(
        source,
        `${route} never asks canGoBack() — a cold notification tap strands it with no way to Home`,
      ).toContain("canGoBack");
      expect(
        source,
        `${route} asks canGoBack() but renders no HeaderHomeButton, so the answer goes nowhere`,
      ).toContain("HeaderHomeButton");
    }
  });

  it("still has the button component the screens reach for", () => {
    // Otherwise the assertion above is satisfied by an import of something
    // that no longer exists, which typechecks nowhere but greps fine.
    const button = join(__dirname, "..", "components", "HeaderHomeButton.tsx");
    expect(existsSync(button), "HeaderHomeButton.tsx is gone").toBe(true);
    expect(stripComments(readFileSync(button, "utf8"))).toContain("replace");
  });
});
