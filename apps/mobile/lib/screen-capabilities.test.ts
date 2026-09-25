import { existsSync, readFileSync } from "node:fs";
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
      // The noun is a dictionary KEY, not an English phrase: the refusal
      // sentence around it is translated, so a screen named in English
      // inside a Spanish sentence is the half-translated screen the whole
      // i18n layer exists to prevent. That the key EXISTS is proved by the
      // type — `SCREEN_NOUN` is `Record<GuardedScreen, StringKey>`, so a
      // missing entry fails the build — and that Spanish HAS it is proved
      // by strings-census.test.ts. What this line catches is the other
      // failure, which neither of those can see: an English noun left
      // behind in the table, which is a perfectly valid string.
      expect(SCREEN_NOUN[screen] ?? "", `${screen} names itself in English rather than by key`).toMatch(
        /^[a-z][A-Za-z]*(\.[A-Za-z]+)+$/,
      );
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

  it("gates the capture surface that makes field records", () => {
    // Create and Camera used to be tabs; both wrote field records and had
    // no jobId, so they sat outside the table above — and were the two tabs
    // an estimator used to be handed, every option on them 403ing. They are
    // one floating button over one sheet now, and the gate moved with them:
    // the button is the only way to open the sheet, and it renders only for
    // MANAGE_FIELD.
    const layout = readFileSync(join(__dirname, "..", "app", "(tabs)", "_layout.tsx"), "utf8");
    expect(layout, "the capture button is not gated by MANAGE_FIELD").toContain('holds(me, "MANAGE_FIELD")');
    expect(layout, "the capture button renders for people who must not have it").toContain(
      "field ? <FloatingCaptureButton",
    );
    const sheet = readFileSync(join(__dirname, "..", "components", "CaptureSheet.tsx"), "utf8");
    expect(sheet.length, "the capture sheet is missing").toBeGreaterThan(100);
    // The refusal is a KEY now, not a sentence — this asserted the English
    // wording and went red when the sheet was translated, which is the
    // assertion being wrong rather than the sheet. What matters is that
    // the refusal is still rendered; how it reads is the dictionary's
    // business, and `strings-census.test.ts` proves the key has both halves.
    expect(sheet, "the capture sheet lost the pick-a-job refusal").toContain('t("capture.pickFirst")');
    // …and the old tab files are GONE, not just off the bar — a route that
    // still exists is a route a stale deep link can reach unguarded.
    for (const tab of ["create", "camera"]) {
      expect(existsSync(join(__dirname, "..", "app", "(tabs)", `${tab}.tsx`)), `${tab} tab still exists`).toBe(false);
    }
  });
});
