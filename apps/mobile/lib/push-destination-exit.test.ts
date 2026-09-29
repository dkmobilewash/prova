import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY screen a notification can cold-start must render a way out IN ITS
 * BODY.
 *
 * **This census has now been wrong twice, in two different ways, and both
 * are worth more than the assertion it makes today.**
 *
 *   1. It first asserted the screen files CONTAINED `canGoBack` and
 *      `HeaderHomeButton`. They did. It passed — size assertion holding,
 *      scope assertion holding — on an app where nothing rendered.
 *   2. It was then rewritten to assert the LAYOUT wired those options. It
 *      did. It passed again. Nothing rendered again.
 *
 * Both times the pattern matched, the set was complete, and the answer was
 * irrelevant: a census can only tell you the code is THERE, never that a
 * framework honours it. Three header-based fixes shipped (#548, #553, #554)
 * and not one reached a phone.
 *
 * So the thing being asserted changed, not the rigour. The way out is now a
 * view in the screen body — rendered by React like every other pixel — and
 * that is something a test in this repo can actually see: `WayHome` mounts
 * in `screens/way-home.test.tsx` and either renders a pressable or does not.
 *
 * What is left here is the STRUCTURAL half, and it is mostly a set of
 * anti-regressions: that every push destination renders the control, and
 * that nobody quietly moves it back into the header, in either of the two
 * places it has already failed.
 *
 * The two derivation guards stay, because they still answer real questions:
 *
 *   - SIZE — routes parsed must equal routes counted by a second
 *     expression sharing no regex with the first.
 *   - SCOPE — every parsed route must resolve to a screen file that EXISTS.
 *
 * Comments are stripped before matching, and it is load-bearing here: this
 * file, `wayHome.tsx` and both screens all discuss the header failure in
 * prose, so a raw-text census would find `Stack.Screen` everywhere and flag
 * files that are clean.
 */

const APP = join(__dirname, "..", "app");
const ROUTER = join(__dirname, "push-target.ts");
const LAYOUT = join(APP, "_layout.tsx");
const WAY_HOME = join(__dirname, "..", "components", "wayHome.tsx");

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

const routerSource = readFileSync(ROUTER, "utf8");
const destinations = pushDestinations(routerSource);

describe("every push destination renders a way out in its body", () => {
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

  it("renders <WayHome /> on every destination", () => {
    for (const route of destinations) {
      const file = screenFileFor(route);
      expect(file, `no screen file for ${route}`).not.toBe(null);
      const source = stripComments(readFileSync(file as string, "utf8"));

      expect(
        source,
        `${route} does not render <WayHome />, so a cold notification tap strands it. ` +
          `Put it in the BODY — three header-based attempts shipped and none rendered.`,
      ).toContain("<WayHome />");
    }
  });

  it("keeps the way out of the header, in both places it already failed", () => {
    // The regression that would look most like a fix. Someone reading the
    // iOS conventions will reasonably want this in the header; it has been
    // tried three times and never once reached a phone.
    for (const route of destinations) {
      const file = screenFileFor(route);
      const source = stripComments(readFileSync(file as string, "utf8"));
      expect(
        source,
        `${route} sets header options from inside the screen again — that call is dropped on a ` +
          `cold launch (#548, #553). The way out belongs in the screen body.`,
      ).not.toContain("Stack.Screen");
    }

    const layout = stripComments(readFileSync(LAYOUT, "utf8"));
    expect(
      layout,
      "app/_layout.tsx wires a headerLeft again — that was #554, and it did not render either.",
    ).not.toContain("headerLeft");
  });

  it("still has a WayHome that renders unconditionally and leaves rather than stacks", () => {
    // Otherwise the assertion above is satisfied by an import of something
    // that renders nothing, which typechecks and greps fine.
    expect(existsSync(WAY_HOME), "components/wayHome.tsx is gone").toBe(true);
    const source = stripComments(readFileSync(WAY_HOME, "utf8"));

    // UNCONDITIONAL on purpose, fourth attempt. An early `return null` is
    // how this control renders nothing, and "renders nothing" is precisely
    // the failure that shipped three times. Whether `canGoBack()` is false
    // on a cold tap is an INFERENCE nothing here has observed — so the
    // control does not bet on it. Re-add a condition only after somebody
    // has confirmed on a phone that this renders at all.
    expect(
      source,
      "WayHome gained an early return — it can now render nothing, which is the exact failure " +
        "that shipped three times. Confirm on a device before making this conditional again.",
    ).not.toContain("return null");

    expect(source, "WayHome must replace, not push — a push keeps the dead end underneath").toContain(
      'replace("/(tabs)")',
    );
  });
});
