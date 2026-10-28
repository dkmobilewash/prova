/**
 * EVERY TAKEOFF SWITCH IS ACTUALLY ON THE SETTINGS PAGE.
 *
 * THE SCAR. On 2026-10-27, asked to find the demote switch on production, a
 * tester searched Company, Estimating defaults and Assistant and reported it
 * missing. It was not missing: it rendered unconditionally, one block under
 * "Find the rooms", on the commit production was serving. The heading simply
 * used none of the words anybody says about the feature. Proving that cost an
 * hour, and the first instinct — "restore it" — would have edited a working
 * screen.
 *
 * What the hour showed is that NOTHING asserted the page renders these at all.
 * The e2e specs flip the switches, which proves the ACTION works and says
 * nothing about whether a person can reach it; `takeoffDemotedWalls.test.tsx`
 * renders the component directly, which proves the component works and says
 * nothing about the page importing it. A merge conflict in `settings/page.tsx`
 * could drop a switch and every one of those stays green — and that file took
 * a conflict in two of the last three PRs, one of which left two queries both
 * selecting `roomFinderOn`.
 *
 * So this ties the three halves together: the switch is imported, it is
 * rendered, and the owner's own role decides whether it can be changed rather
 * than whether it is shown. A switch nobody can see is off for a reason nobody
 * chose.
 *
 * THE SIZE CHECK COMES FIRST, because a census that reads nothing finds
 * nothing wrong with it: the file has to parse to something before any claim
 * below it means anything.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGE = new URL("../app/(app)/settings/page.tsx", import.meta.url);
const source = readFileSync(PAGE, "utf8");

/** Comments are stripped because this file documents its own history, and that
 *  prose names the very components the assertions look for — the trap
 *  `clerkMountGate.test.ts` records, where a census passed on a sentence
 *  describing the code rather than the code. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Each switch a company owner turns on or off from Settings. The NAME is the
 *  component; the heading it prints is deliberately NOT asserted, because the
 *  words on screen are a product decision that should be free to change —
 *  which is exactly what happened to the demote switch. */
const SWITCHES = ["RoomFinderSwitch", "DemotedWallsSwitch"] as const;

describe("the settings page renders every takeoff switch", () => {
  it("parsed a settings page at all, so the checks below are about something", () => {
    expect(source.length, "settings/page.tsx is empty or unreadable").toBeGreaterThan(2000);
    expect(code).toContain("export default");
    // If this ever reads zero the file moved, and every assertion below would
    // pass vacuously on an empty string.
    expect(code.length).toBeGreaterThan(1000);
  });

  for (const name of SWITCHES) {
    describe(name, () => {
      it("is imported by the settings page", () => {
        expect(code, `${name} is not imported — Settings cannot render it`).toMatch(
          new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`),
        );
      });

      it("is RENDERED, not merely imported", () => {
        expect(code, `${name} is imported but never rendered`).toMatch(new RegExp(`<${name}\\b`));
      });

      it("shows for everyone and is EDITABLE by the owner only", () => {
        // The switch takes `isOwner` so it can disable its control. A page that
        // instead rendered it behind `role === "OWNER"` would hide the setting
        // from everybody else, and the absence of a feature would have no
        // explanation anywhere a person could find — which is the reason the
        // room finder's own comment gives for showing it to all.
        const at = code.indexOf(`<${name}`);
        expect(at, `${name} is not rendered`).toBeGreaterThan(-1);
        const tag = code.slice(at, code.indexOf("/>", at) + 2);
        expect(tag, `${name} is not told who the owner is`).toContain("isOwner");
      });
    });
  }

  it("names as many switches as it checks, so a deletion here is visible", () => {
    // The list above is the whole claim. If somebody removes an entry rather
    // than fixing the page, this number moves with it and the diff says so.
    expect(SWITCHES.length).toBe(2);
  });
});
