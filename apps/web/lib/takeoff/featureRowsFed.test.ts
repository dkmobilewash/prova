/**
 * THE TAKEOFF FEATURES LIST IS TOLD ABOUT EVERY SWITCH THE PAGE READS.
 *
 * `TakeoffFeatureInputs` makes the newer switches OPTIONAL and documents them
 * "null until they exist on this build", and `onOff(null)` renders "not on this
 * build yet". That is the right default for a switch that has not shipped, and
 * it is a trap for one that just has: omit the flag and the list tells an owner
 * a working switch does not exist — on the very list built so nobody has to
 * hunt for switches.
 *
 * It is not hypothetical. #827 was written when neither `wholeSetTakeoffOn`
 * (#820) nor `scannedPlansOn` (#825) was on main, so its call correctly omitted
 * both. Merging it after those two landed left the omission behind as a silent
 * mis-report, and nothing in the type system objects: both fields are optional
 * by design.
 *
 * So the rule is a relation between two files rather than a property of either:
 * if the settings page SELECTS a switch, the feature list must be GIVEN it.
 * That is what this checks, deriving the switch names from the page's own
 * select rather than from a list here that would drift.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGE = new URL("../../app/(app)/settings/page.tsx", import.meta.url).pathname;
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const page = strip(readFileSync(PAGE, "utf8"));

/** The switch columns the page asks the database for. */
function selectedSwitches(): string[] {
  const m = page.match(/select:\s*\{([^}]*On:\s*true[^}]*)\}/);
  expect(m, "could not find the switches select on the settings page").not.toBeNull();
  return [...m![1].matchAll(/(\w+On):\s*true/g)].map((x) => x[1]);
}

/** What the `takeoffFeatureRows({ ... })` call is given. */
function fedToRows(): string {
  const at = page.indexOf("takeoffFeatureRows({");
  expect(at, "the page does not call takeoffFeatureRows").toBeGreaterThan(-1);
  const end = page.indexOf("});", at);
  expect(end, "the takeoffFeatureRows call is not terminated").toBeGreaterThan(at);
  return page.slice(at, end);
}

describe("every switch the settings page reads reaches the feature list", () => {
  it("found a real set of switches to check", () => {
    const found = selectedSwitches();
    expect(found.length, "no switch columns parsed off the page").toBeGreaterThanOrEqual(4);
    expect(found).toContain("roomFinderOn");
  });

  it("passes each one to takeoffFeatureRows", () => {
    const call = fedToRows();
    for (const name of selectedSwitches()) {
      expect(
        call,
        `the page reads ${name} but does not pass it to takeoffFeatureRows, so the list will claim ` +
          `that feature is not on this build`,
      ).toContain(name);
    }
  });
});
