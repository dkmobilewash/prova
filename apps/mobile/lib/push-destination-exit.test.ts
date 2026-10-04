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
const TAB_LAYOUT = join(APP, "(tabs)", "_layout.tsx");
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
/** The route groups a URL can be hiding inside. expo-router strips these
 * from the path — `app/(tabs)/alerts.tsx` IS `/alerts` — so a resolver that
 * only walks literal segments reports "no screen file" for a screen that
 * exists and renders. Derived from the directory listing rather than
 * hardcoded, so adding a group does not silently shrink this census. */
function routeGroups(): string[] {
  return readdirSync(APP).filter((name) => /^\(.+\)$/.test(name));
}

function screenFileFor(route: string): string | null {
  const segments = route.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  // Try the literal path first, then the same path inside each route group.
  for (const prefix of [null, ...routeGroups()]) {
    let dir = prefix ? join(APP, prefix) : APP;
    for (let i = 0; i < segments.length - 1; i++) dir = join(dir, segments[i]);
    if (!existsSync(dir)) continue;

    const last = segments[segments.length - 1];
    if (last.includes("${")) {
      const match = readdirSync(dir).find((name) => /^\[.+\]\.tsx$/.test(name));
      if (match) return join(dir, match);
      continue;
    }
    const file = join(dir, `${last}.tsx`);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Whether a destination is a TAB. A tab's way out is the tab bar, which
 * the navigator always renders; a stack destination has only whatever the
 * screen itself draws. That distinction is the whole of the rule below. */
function isTabDestination(route: string): boolean {
  const file = screenFileFor(route);
  return file != null && routeGroups().some((group) => file.includes(`${group}/`));
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

  it("gives every destination a way out — a tab bar, or <WayHome /> in its body", () => {
    // THE RULE SPLIT WHEN /alerts BECAME A TAB, AND IT IS NOW STRICTER
    // RATHER THAN LOOSER.
    //
    // The old rule was one blanket sentence: every destination renders
    // <WayHome />. That was right while every destination was a bare stack
    // screen. It stops being right the moment a destination is a TAB,
    // because the dead end it guards cannot occur there — the navigator
    // renders the bar on every frame, cold launch included, which is a
    // stronger guarantee than a view a screen has to remember to draw.
    //
    // Worse, keeping it would have been actively wrong: `WayHome` renders
    // when `canGoBack()` is false, which at a tab root is ALWAYS, so a
    // redundant Home button would sit at the top of the Alerts tab forever.
    //
    // So each destination is asserted against the mechanism it actually
    // has, and neither case is unchecked:
    //   TAB   -> must be declared in the tab layout, and must NOT draw
    //            WayHome (the redundant-button regression).
    //   STACK -> must draw WayHome in its body, exactly as before.
    const tabLayout = stripComments(readFileSync(TAB_LAYOUT, "utf8"));

    for (const route of destinations) {
      const file = screenFileFor(route);
      expect(file, `no screen file for ${route}`).not.toBe(null);
      const source = stripComments(readFileSync(file as string, "utf8"));

      if (isTabDestination(route)) {
        const name = route.replace(/^\//, "");
        expect(
          tabLayout,
          `${route} resolves inside a route group but the tab layout declares no "${name}" screen. ` +
            `Then it has neither a tab bar nor a WayHome, which is the dead end in a new costume.`,
        ).toContain(`name="${name}"`);
        expect(
          source,
          `${route} is a tab and still draws <WayHome />. canGoBack() is false at a tab root, so ` +
            `that renders a redundant Home button on every visit. The tab bar is the way out.`,
        ).not.toContain("<WayHome />");
        continue;
      }

      expect(
        source,
        `${route} does not render <WayHome />, so a cold notification tap strands it. ` +
          `Put it in the BODY — three header-based attempts shipped and none rendered.`,
      ).toContain("<WayHome />");
    }
  });

  it("still has at least one of each kind, so neither branch is vacuous", () => {
    // A split rule can be satisfied by an empty branch. Today /alerts is
    // the tab and /job/[jobId] is the stack screen; if either side reaches
    // zero the assertion above has quietly stopped testing something.
    const tabs = destinations.filter(isTabDestination);
    const stacks = destinations.filter((route) => !isTabDestination(route));
    expect(tabs.length, "no tab destinations — the tab branch above tests nothing").toBeGreaterThan(0);
    expect(
      stacks.length,
      "no stack destinations — the WayHome branch above tests nothing, and that is the branch four " +
        "releases were spent on",
    ).toBeGreaterThan(0);
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

  it("still has a WayHome that decides, and leaves rather than stacks", () => {
    // Otherwise the assertion above is satisfied by an import of something
    // that renders nothing, which typechecks and greps fine.
    expect(existsSync(WAY_HOME), "components/wayHome.tsx is gone").toBe(true);
    const source = stripComments(readFileSync(WAY_HOME, "utf8"));

    expect(
      source,
      "WayHome no longer asks canGoBack — it would appear beside a real back chevron on warm taps",
    ).toContain("canGoBack");

    expect(source, "WayHome must replace, not push — a push keeps the dead end underneath").toContain(
      'replace("/(tabs)")',
    );

    // NOTE ON WHAT THIS FILE CANNOT DO, because the answer used to live here
    // and was wrong. Whether the control actually RENDERS is not a question
    // any census can answer — that is the whole reason three releases
    // shipped a header button that did nothing while a census went green.
    // Both directions are pinned behaviourally in
    // `screens/way-home.test.tsx`, which mounts it: present when the stack
    // is empty, absent when it is not. Do not try to strengthen this
    // assertion into covering that; strengthen the mount test instead.
  });
});
