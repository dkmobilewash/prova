import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY screen a notification can cold-start must be given a way out BY THE
 * LAYOUT.
 *
 * **Rewritten after this census passed on an app that was broken.** Its
 * first version asserted that each destination's SCREEN file contained
 * `canGoBack` and `HeaderHomeButton`. Both files did. Both were green. And
 * on a real phone neither screen offered anything, because
 * `<Stack.Screen options={{ headerLeft }} />` INSIDE a page delegates to a
 * `navigation.setOptions` call that a cold deep-link launch silently skips
 * (expo-router 57.0.21, `views/Screen.js`; `StackScreen.js` says as much in
 * its own warning and docstring). The code was written, it ran, and the
 * framework discarded it.
 *
 * So the lesson is not "assert harder", it is **assert about the mechanism
 * that actually delivers**. A census pointed at the wrong location cannot
 * be saved by a size or a scope assertion: both of those ask whether the
 * set is complete, and this set was complete and irrelevant. Same family as
 * the `content`-glob scope scar and the second-list scar, arriving from a
 * third side — *nothing is ever missing from a question nobody is asking.*
 *
 * The delivery half is `app/_layout.tsx`, where `title` demonstrably
 * renders on these very screens. The decision half is pure and is tested
 * directly in `screens/way-home.test.tsx`.
 *
 * The two derivation guards are kept, because they still earn their place:
 *
 *   - SIZE — routes parsed must equal routes counted by a second
 *     expression sharing no regex with the first.
 *   - SCOPE — every parsed route must resolve to a screen file that EXISTS.
 *
 * Comments are stripped before matching. Load-bearing: `wayHome.tsx` and
 * this file both discuss `headerLeft` and `canGoBack` at length, and the
 * layout carries a comment explaining the whole defect.
 */

const APP = join(__dirname, "..", "app");
const ROUTER = join(__dirname, "push-target.ts");
const LAYOUT = join(APP, "_layout.tsx");

/** JS/TS comments removed, so a census cannot be satisfied by prose. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Every route `targetFromData` can return, read out of the function. */
function pushDestinations(source: string): string[] {
  const found = [...source.matchAll(/return\s+(["'`])(\/[^"'`]*)\1/g)].map((m) => m[2]);
  return [...new Set(found)];
}

/** The same count reached a different way, so the two cannot drift together. */
function routeReturningLineCount(source: string): number {
  return source
    .split("\n")
    .filter((line) => /\breturn\b/.test(line) && !/\bnull\b/.test(line) && line.includes("/"))
    .length;
}

/** The screen file a route renders, or null if none can be found. */
function screenFileFor(route: string): string | null {
  const segments = route.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  let dir = APP;
  for (let i = 0; i < segments.length - 1; i++) dir = join(dir, segments[i]);
  if (!existsSync(dir)) return null;

  const last = segments[segments.length - 1];
  if (last.includes("${")) {
    const match = readdirSync(dir).find((name) => /^\[.+\]\.tsx$/.test(name));
    return match ? join(dir, match) : null;
  }
  const file = join(dir, `${last}.tsx`);
  return existsSync(file) ? file : null;
}

/**
 * The expo-router route name for a screen file — what `<Stack.Screen name>`
 * must say. Derived from the file's own path so a rename cannot leave this
 * census looking for something that no longer exists.
 */
function routeNameFor(file: string): string {
  return relative(APP, file).replace(/\.tsx$/, "");
}

/**
 * The `options={...}` text the layout declares for one route name.
 *
 * Returns null when the route is not declared at all, which is its own
 * failure and must not read as "declared without a way home".
 */
function layoutOptionsFor(layout: string, routeName: string): string | null {
  const at = layout.indexOf(`name="${routeName}"`);
  if (at === -1) return null;
  const end = layout.indexOf("/>", at);
  return end === -1 ? null : layout.slice(at, end);
}

const routerSource = readFileSync(ROUTER, "utf8");
const destinations = pushDestinations(routerSource);
const layoutSource = stripComments(readFileSync(LAYOUT, "utf8"));

describe("every push destination is given a way out by the layout", () => {
  it("parses the same number of routes the router returns", () => {
    expect(
      destinations.length,
      "the route extractor and the line count disagree — one of the two patterns has drifted",
    ).toBe(routeReturningLineCount(routerSource));
  });

  it("finds more than one destination, so the census is not vacuous", () => {
    expect(destinations.length).toBeGreaterThan(1);
  });

  it("resolves every destination to a screen file that exists", () => {
    for (const route of destinations) {
      expect(screenFileFor(route), `no screen file on disk for push destination ${route}`).not.toBe(
        null,
      );
    }
  });

  it("declares every destination in the layout with a way home", () => {
    for (const route of destinations) {
      const file = screenFileFor(route);
      expect(file, `no screen file for ${route}`).not.toBe(null);
      const name = routeNameFor(file as string);

      const options = layoutOptionsFor(layoutSource, name);
      expect(
        options,
        `${route} (${name}) is not declared in app/_layout.tsx — a push can open a screen the layout has never configured`,
      ).not.toBe(null);

      expect(
        options,
        `${name} is declared without wayHomeOptions, so a cold notification tap strands it. ` +
          `Do NOT "fix" this by putting <Stack.Screen options> back inside the screen — that is ` +
          `the exact thing that shipped twice and did nothing (see components/wayHome.tsx).`,
      ).toContain("wayHomeOptions");
    }
  });

  it("keeps the decision out of the screens, where it did not work", () => {
    // The regression that matters most, because it is the one that looks
    // like a fix. A screen-level `<Stack.Screen options>` is not merely
    // redundant now — it is the broken mechanism, and someone re-adding it
    // would believe they had restored something.
    for (const route of destinations) {
      const file = screenFileFor(route);
      const source = stripComments(readFileSync(file as string, "utf8"));
      expect(
        source,
        `${route} sets header options from inside the screen again — that call is silently ` +
          `dropped on a cold launch. The way home belongs in app/_layout.tsx.`,
      ).not.toContain("Stack.Screen");
    }
  });

  it("still has the button component the layout reaches for", () => {
    const button = join(__dirname, "..", "components", "HeaderHomeButton.tsx");
    expect(existsSync(button), "HeaderHomeButton.tsx is gone").toBe(true);
    expect(stripComments(readFileSync(button, "utf8"))).toContain("replace");
  });
});
