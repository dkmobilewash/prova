import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ── SAVING A SCALE STARTS THE DETECTION ──
 *
 * The one trigger. Everything else in this feature is unit-tested as a pure
 * function; this is the wire between them, and it is in a Server Action that
 * needs Clerk, a database and a PDF, so nothing here can call it.
 *
 * SO THIS IS A SOURCE CENSUS, AND IT IS THE WEAK HALF OF A PAIR. It proves the
 * call is written. It cannot prove the framework runs it — CLAUDE.md's
 * expo-router entry is three fixes that shipped green doing exactly that, and
 * the rule it leaves behind is to prefer a fix that is checkable. The checkable
 * half here is everything the call hands over: `proposalRowsFor`,
 * `storedRunsOf`, `evidenceOf` and `groupsFromProposals` are all pure and all
 * tested by `wallProposal.test.ts`, and the seeding is rendered in
 * `storedWallsSeeding.test.tsx`.
 *
 * What is left unproved by any test, and is stated rather than implied: that
 * `after()` actually fires in production, and that a real PDF yields the groups
 * this writes. Those need the pilot journey and a person on the click-list.
 *
 * Two mutations are the reason it exists at all: replacing the call with a
 * `void` expression, and gating it off with `if (false)`, both left the whole
 * suite green.
 */

const action = () => readFileSync(resolve(process.cwd(), "lib/actions/takeoff.ts"), "utf8");

/** The source with comments stripped, so prose describing the call cannot
 *  satisfy a census about the call. CLAUDE.md pays for this twice in
 *  `OpeningDeductionForm.tsx`, and this file's own header mentions the
 *  function it is asserting. */
const code = () =>
  action()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("the calibration save is what starts wall detection", () => {
  it("READ THE FILE IT THINKS IT IS READING", () => {
    // The size assertion this repo asks of anything that greps: a moved path
    // must fail loudly rather than match nothing and pass everything after it.
    expect(action().length).toBeGreaterThan(5000);
    expect(code()).toContain("saveTakeoffCalibration");
  });

  it("CALLS IT, with the page and the calibration it just wrote", () => {
    const text = code();
    expect(text, "nothing starts detection when a scale is saved").toContain(
      "detectWallsAfterResponse({",
    );
    // THE CALIBRATION'S OWN ID, not the page's newest. The row is keyed to the
    // scale it was found at, and handing it anything else would attach the
    // proposals to a calibration they were not measured under.
    expect(text).toMatch(/calibrationId: calibration\.id/);
    expect(text).toMatch(/pageId: page\.id/);
  });

  it("AFTER the save, never before it", () => {
    // Ordering, because a detection that ran first would be measuring against
    // a calibration that does not exist yet — and `createMany` would fail the
    // foreign key, inside a catch, silently.
    const text = code();
    const created = text.indexOf("takeoffScaleCalibration.create(");
    const detected = text.indexOf("detectWallsAfterResponse(");
    expect(created).toBeGreaterThan(-1);
    expect(detected).toBeGreaterThan(created);
  });

  it("gates on the scale being USABLE, which is the one case with nothing to measure with", () => {
    // `feetPerPageWidth` returns null for a span too short to divide by. There
    // is no detection to attempt then, as opposed to a sheet where there is
    // nothing to find.
    expect(code()).toMatch(/feetPerUnit = feetPerPageWidth\(/);
    expect(code()).toMatch(/if \(feetPerUnit !== null\)/);
  });

  it("USES THE APP'S ONE SCALE READER, so detection measures what the screen measures", () => {
    // Not a second division written out by hand. The whole reason
    // `feetPerPageWidth` exists is that the scale is two stored numbers divided
    // and a second implementation is a second answer.
    expect(code()).not.toMatch(/declaredDistanceFeet\s*\/\s*Math\.hypot/);
  });

  it("DOES NOT AWAIT IT — the save must not wait for a courtesy job", () => {
    // An `await` here would put a PDF parse on the critical path of pressing
    // Save, and a throw on the user's screen. `detectWallsAfterResponse`
    // returns void for that reason.
    expect(code()).not.toMatch(/await detectWallsAfterResponse/);
  });
});
