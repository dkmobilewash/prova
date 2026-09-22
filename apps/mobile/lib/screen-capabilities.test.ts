import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCREEN_CAPABILITY, SCREEN_NOUN, SCREEN_ROUTE, type GuardedScreen } from "./screen-capabilities";

/**
 * The phone's idea of who can see what must be the SERVER's idea of it.
 *
 * A shell that hides a screen the server would have allowed is a foreman
 * who cannot do his job; a shell that shows one the server refuses is the
 * 403-after-you-tap this whole change exists to end. Neither is visible
 * in review, because both sides look reasonable on their own.
 *
 * So this reads the capability out of the ROUTE FILE for each screen and
 * requires the table to match. The table is the only copy the phone
 * carries and it is checked against the source of truth on every build.
 */

const API = join(__dirname, "..", "..", "web", "app", "api", "v1");

/** What the route asserts, read rather than assumed. */
function capabilityAssertedBy(routePath: string): string[] {
  const source = readFileSync(join(API, routePath), "utf8");
  const found = [...source.matchAll(/can\(context,\s*"([A-Z_]+)"\)/g)].map((m) => m[1]);
  return [...new Set(found)];
}

describe("the phone's role shell against the server's own guards", () => {
  it("asks for exactly the capability each route asserts", () => {
    const screens = Object.keys(SCREEN_CAPABILITY) as GuardedScreen[];
    // A table that has quietly emptied would pass every check below.
    expect(screens.length).toBeGreaterThan(6);

    for (const screen of screens) {
      const asserted = capabilityAssertedBy(SCREEN_ROUTE[screen]);
      expect(asserted, `${SCREEN_ROUTE[screen]} asserts no capability at all — the shell would be decoration`).toEqual([
        SCREEN_CAPABILITY[screen],
      ]);
    }
  });

  it("has a screen file and a sentence for every guarded screen", () => {
    for (const screen of Object.keys(SCREEN_CAPABILITY) as GuardedScreen[]) {
      const file = join(__dirname, "..", "app", `${screen}.tsx`);
      expect(readFileSync(file, "utf8").length, `${screen} has no screen file`).toBeGreaterThan(100);
      expect(SCREEN_NOUN[screen]?.length ?? 0, `${screen} has no noun for the refusal sentence`).toBeGreaterThan(2);
    }
  });

  it("actually renders the guard on every screen in the table", () => {
    // The table is worth nothing if a screen does not consult it. This is
    // the "written, documented, and never called" shape CLAUDE.md names —
    // and the reason it is asserted rather than assumed is that a screen
    // with the import and no call typechecks perfectly.
    for (const screen of Object.keys(SCREEN_CAPABILITY) as GuardedScreen[]) {
      const source = readFileSync(join(__dirname, "..", "app", `${screen}.tsx`), "utf8");
      expect(source, `${screen} never asks who is holding the phone`).toContain("useMe()");
      expect(source, `${screen} does not check its capability`).toContain(`SCREEN_CAPABILITY["${screen}"]`);
      expect(source, `${screen} has no sentence for somebody who cannot see it`).toContain("NotYourJobFunction");
    }
  });

  it("guards the two tabs that make field records", () => {
    // Create and Camera write field records and have no jobId, so they are
    // not in the table above — but they are the two tabs an estimator used
    // to be handed, every option on them 403ing.
    for (const tab of ["create", "camera"]) {
      const source = readFileSync(join(__dirname, "..", "app", "(tabs)", `${tab}.tsx`), "utf8");
      expect(source, `the ${tab} tab does not check MANAGE_FIELD`).toContain('holds(me, "MANAGE_FIELD")');
      expect(source).toContain("NotYourJobFunction");
    }
    const layout = readFileSync(join(__dirname, "..", "app", "(tabs)", "_layout.tsx"), "utf8");
    // …and are taken off the bar rather than sitting there as a trap.
    expect(layout).toContain("href: field ? undefined : null");
  });
});
