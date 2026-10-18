import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ── READ THIS SHEET MUST BE REACHABLE ON THE SHEETS IT EXISTS FOR ──
 *
 * It shipped behind `found !== null && strokesSeen === 0` — show it once Find
 * the walls has run and come back with no lines, which is what a scan looks
 * like. That reads as the careful choice. It is a DEADLOCK:
 *
 *   Find the walls is disabled until the sheet has a scale (`!calibration`)
 *     → a scan's scale is printed on the drawing and nowhere else
 *       → reading the drawing is what Read this sheet does
 *         → which could not be pressed until Find the walls had run.
 *
 * The one control that breaks the cycle was inside it. The feature was
 * unreachable on every sheet it was built for, and the only escape was to set
 * a scale by hand — which is the thing it exists to save you doing.
 *
 * NOTHING IN THIS REPO COULD SEE IT. `aiSurfaceCensus` asserts the control
 * exists, is in a real component and is rendered from a page: all true. A
 * census reads SOURCE; reachability is a property of state at runtime. It took
 * a person clicking, who reported "Find the walls stays greyed out until a
 * sheet has a scale" — the same shape as #764, where three `required` radios
 * on a sibling question made a perfect field unsaveable.
 *
 * So this asserts the gate is INDEPENDENT of the cycle rather than asserting
 * the control exists. A gate that mentions the wall finder's own state is the
 * defect, whatever else is true of it.
 */

const VIEWER = readFileSync(resolve(process.cwd(), "components/TakeoffPlanViewer.tsx"), "utf8");
/** Comments FIRST: this component explains the deadlock in its own prose and
 *  quotes the broken condition doing it, so a raw-text census would find the
 *  bug in the explanation of the fix. */
const CODE = VIEWER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * The JSX condition guarding the button, read from the button itself.
 *
 * -- THIS HELPER GOT IT WRONG FIRST, AND THREE ASSERTIONS PASSED ON IT --
 *
 * It walked back from the attribute to the nearest `{`, which is the button's
 * own `disabled={reading}` -- a seven-character slice containing none of the
 * words this file forbids. Two cases failed loudly; the three looking for
 * something to be ABSENT passed, because nothing is ever present in the wrong
 * seven characters. So the slice is taken from the `<button` tag back, and it
 * is asserted to look like a conditional before anything is read off it.
 */
function gate(): string {
  const attr = CODE.indexOf('data-takeoff="read-sheet"');
  expect(attr, "the Read this sheet button is gone from the viewer").toBeGreaterThan(-1);
  const tag = CODE.lastIndexOf("<button", attr);
  expect(tag, "the attribute is not on a button").toBeGreaterThan(-1);
  const open = CODE.lastIndexOf("{", tag);
  expect(open, "the button has no enclosing expression").toBeGreaterThan(-1);
  const slice = CODE.slice(open, tag);
  // The control: a slice that is not a JSX conditional cannot answer any
  // question below, and would answer "absent" to all of them.
  expect(slice, `the slice read is not a conditional: ${JSON.stringify(slice.slice(0, 80))}`).toMatch(/&&/);
  return slice;
}

describe("the scan reader can actually be reached", () => {
  it("IS GATED ON THE SHEET BEING A SCAN", () => {
    expect(gate()).toMatch(/scannedPages/);
  });

  it("DOES NOT WAIT FOR FIND THE WALLS, which is disabled without a scale", () => {
    // The deadlock, stated as the thing that must not come back. `found` is
    // the wall finder's result and `strokesSeen` its stroke count; a scan
    // cannot produce either until it has a scale it cannot get.
    const g = gate();
    expect(g, "gated on the wall finder's result — this is the deadlock").not.toMatch(/\bfound\b/);
    expect(g, "gated on the wall finder's stroke count — this is the deadlock").not.toMatch(/strokesSeen/);
  });

  it("DOES NOT WAIT FOR A SCALE", () => {
    // The other half of the cycle, and the one that makes it airtight: a scan
    // has no scale until this button has been pressed.
    expect(gate(), "gated on the calibration a scan cannot have yet").not.toMatch(/calibration/);
  });

  it("gets its scan flag from ingest rather than deriving it in the viewer", () => {
    // Whether a page carries a text layer is settled when the file is read and
    // cannot be worked out from a `PlanSheet` — a sheet row only exists once
    // somebody has saved a calibration, so a scan has no row at all.
    expect(CODE).toMatch(/scannedPages:\s*number\[\]/);
    const page = readFileSync(
      resolve(process.cwd(), "app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx"),
      "utf8",
    );
    // The COMPUTATION is in the loader both takeoff pages share; the PROP
    // below is on the page that passes it.
    const loader = readFileSync(resolve(process.cwd(), "lib/takeoff/workspaceLoad.ts"), "utf8");
    expect(loader).toMatch(/scannedPages\s*=\s*sheetRows\.filter\(\(row\) => !row\.hasTextLayer\)/);
    expect(page).toMatch(/scannedPages=\{scannedPages\}/);
  });

  it("does not offer itself on a sheet that is not a scan", () => {
    // The other direction, reported by the same tester: the button appeared on
    // a VECTOR sheet, because `found` was left over from a previous sheet
    // while `strokesSeen` had reset. Keying on the page's own flag makes the
    // stale-state case impossible rather than unlikely.
    expect(gate()).toMatch(/scannedPages\.includes\(pageNumber\)/);
  });
});
