import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The three rails that make a handover a handover, each of which is a
 * one-line edit away from being gone and none of which a typecheck can
 * see.
 *
 * A crew member borrowing the phone to put their hours in must not be
 * able to walk out of that screen into the foreman's app — not by the
 * iOS back gesture, not by a link on the screen, and not by force-quitting
 * and reopening, which is the one everybody tries. The screen looks
 * exactly as correct with any of the three missing.
 */

const APP = join(__dirname, "..", "app");
const handover = readFileSync(join(APP, "handover.tsx"), "utf8");
const layout = readFileSync(join(APP, "_layout.tsx"), "utf8");

describe("the rails on a handed-over phone", () => {
  it("has no way out of the screen except handing the phone back", () => {
    expect(handover.length, "the handover screen is missing or empty").toBeGreaterThan(1000);

    // Every navigation this screen performs, read out of it rather than
    // assumed. The only destination allowed is the foreman's app, and
    // only after the handover has been ended.
    const destinations = [...handover.matchAll(/router\.(push|replace|back)\(\s*"([^"]+)"/g)].map((m) => m[2]);
    expect(destinations.length, "no navigation found at all — did the calls move?").toBeGreaterThan(0);
    expect([...new Set(destinations)]).toEqual(["/(tabs)"]);

    // …and it is not a link to somewhere else wearing a different name.
    expect(handover).not.toMatch(/<Link\b/);
    expect(handover).not.toMatch(/JobSections|CurrentJobBar/);

    // Every exit runs `endHandover` first, so the flag on disk cannot
    // outlive the screen and strand the foreman in a handover.
    expect(handover).toMatch(/endHandover\(\)/);
  });

  it("is registered with the header and the back gesture turned off", () => {
    const route = layout.match(/<Stack\.Screen\s+name="handover"[^/]*\/>/s)?.[0] ?? "";
    expect(route, "the handover route is not registered").not.toBe("");
    expect(route).toContain("headerShown: false");
    // The swipe-back is the one that matters: with it on, the way out of
    // a handover is a thumb.
    expect(route).toContain("gestureEnabled: false");
  });

  it("asks whether the phone is in somebody else's hands before it draws anything", () => {
    // THE FORCE-QUIT RAIL. State in React would be reset by killing the
    // app, which is exactly what someone would do to get out of a screen
    // they did not want to be on — so the flag is on disk and the root
    // layout reads it first.
    expect(layout).toContain("getHandover");
    expect(layout).toMatch(/Redirect\s+href="\/handover"/);

    // AND IT IS ACTUALLY WRAPPED IN IT. The first version of this test
    // asserted only that the gate EXISTED, so deleting the two JSX tags
    // and leaving the function behind passed — "written, documented, and
    // never called", which CLAUDE.md names as a recurring shape here and
    // which this file reproduced on its first mutation run.
    const opens = layout.indexOf("<HandoverGate>");
    const closes = layout.indexOf("</HandoverGate>");
    const stack = layout.indexOf("<Stack ");
    expect(opens, "the gate is defined but nothing is inside it").toBeGreaterThan(-1);
    expect(closes).toBeGreaterThan(opens);
    expect(stack > opens && stack < closes, "the app's screens are not inside the handover gate").toBe(true);
  });
});
