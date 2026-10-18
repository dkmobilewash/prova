// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScaleOffer } from "./TakeoffPlanViewer";
import type { ScalePrefill } from "@/lib/takeoff-plan-view";

/**
 * THE REDUCED-PRINT CORRECTION HAS TO BE ON THE SCREEN, NOT JUST IN THE DATA.
 *
 * A RENDER test and deliberately not a census, for the reason
 * `takeoffWallFinder.test.tsx` gives: #665 shipped a control that existed,
 * called the right action, sat in the right branch and appeared on no screen
 * anybody used, with every census assertion true the whole time.
 *
 * It matters more here than for an ordinary control, because this correction
 * CHANGES A NUMBER an estimator is about to accept — the scale that multiplies
 * through every quantity on the sheet. A correction nobody is told about is
 * worse than no correction: they would accept a figure the app silently
 * altered, with no way to know it had.
 *
 * The page it exists for is the answer key's p50 — an 18in sheet in a 36in set,
 * no dimensions of its own, measured at HALF its real scale and scoring 32%,
 * the worst of all sixty pages.
 *
 * ── WHAT THIS IS EVIDENCE FOR, AND WHAT IT IS NOT ──
 *
 * It renders `ScaleOffer` directly rather than mounting the viewer, and that is
 * a limit of the harness rather than a shortcut. The panel lives in
 * `CalibrationForm`'s draft branch, which needs a line drawn on the sheet — and
 * the sheet is pdf.js on a canvas, which never renders here, so no click can
 * become a point. Measured rather than assumed: a probe pressed Set scale, then
 * the port, then the SVG, and the sheet read "Drawing…" throughout.
 *
 * So this proves the BRANCH and its WORDING. It does not prove the panel is
 * navigable — that is pre-existing behaviour every other scale offer shares, and
 * the click-list is what covers it.
 */

/** What `scalePrefillsFromReadings` produces for p50 once corrected. */
const corrected: ScalePrefill = {
  scaleName: '1/16" = 1\'-0"',
  xs: [0, 1],
  ys: [0.5, 0.5],
  declaredFeet: 288,
  declaredText: "",
  agreed: [],
  considered: 0,
  inheritedError: 0,
  unconfirmed: true,
  reducedPrintCaution:
    "This sheet is 18in wide against 36in on the rest of the set, so it is a half-size print. " +
    "The scale printed on it is the full-size one, so 1/16\" = 1'-0\" is being offered instead — " +
    "otherwise every length off this sheet would be half what it should be. " +
    "Check one known distance before you bid off it.",
};

/** The same sheet with no reduction found — an ordinary printed-scale offer. */
const plain: ScalePrefill = { ...corrected, scaleName: '1/8" = 1\'-0"', reducedPrintCaution: undefined };

/** And a MEASURED offer, which this path must never touch. */
const measured: ScalePrefill = {
  ...plain,
  unconfirmed: false,
  declaredText: `16' - 4 1/2"`,
  agreed: [`16' - 4 1/2"`, `11' - 0"`],
  considered: 30,
  inheritedError: 0.00315,
};

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function paint(prefill: ScalePrefill) {
  act(() => {
    root.render(createElement(ScaleOffer, { prefill, onUse: () => {} }));
  });
  return host;
}

describe("the reduced-print caution", () => {
  it("IS ON THE SCREEN when the sheet is a reduced print", () => {
    expect(paint(corrected).querySelector('[data-takeoff="reduced-print-caution"]')).not.toBeNull();
  });

  it("SAYS WHAT WOULD HAVE GONE WRONG, not only what it did", () => {
    // An estimator has to be able to decide whether to believe it, and "this is
    // a half-size print" alone does not tell them what is at stake.
    const text = paint(corrected).querySelector('[data-takeoff="reduced-print-caution"]')?.textContent ?? "";
    expect(text).toMatch(/half-size print/i);
    expect(text).toContain("18in");
    expect(text).toContain("36in");
    expect(text).toMatch(/every length/i);
    expect(text).toMatch(/known distance/i);
  });

  it("SHOWS THE CORRECTED SCALE, not the one the title block prints", () => {
    const body = paint(corrected).textContent ?? "";
    expect(body).toContain('1/16" = 1\'-0"');
    expect(body).toMatch(/corrected for the reduction/i);
    // And it must NOT still be claiming the title block said this.
    expect(body).not.toMatch(/the title block on this sheet says/i);
  });

  it("IS ABSENT on an ordinary printed-scale sheet", () => {
    // The mutation that matters for a warning: if it renders unconditionally it
    // is noise, and noise gets ignored on the sheet where it counts.
    const ordinary = paint(plain);
    expect(ordinary.querySelector('[data-takeoff="reduced-print-caution"]')).toBeNull();
    expect(ordinary.textContent ?? "").toMatch(/the title block on this sheet says/i);
  });

  it("IS ABSENT on a measured scale, which this path never touches", () => {
    const fromDimensions = paint(measured);
    expect(fromDimensions.querySelector('[data-takeoff="reduced-print-caution"]')).toBeNull();
    // A measured offer shows its evidence, which is the other branch entirely.
    expect(fromDimensions.textContent ?? "").toContain(`16' - 4 1/2"`);
  });

  it("uses the warning token, not an invented colour", () => {
    // `DESIGN.md` governs this and `colorTokenCensus.test.ts` enforces it; the
    // assertion is here so a later edit to the wording cannot quietly drop the
    // class that makes a caution look like one.
    const node = paint(corrected).querySelector('[data-takeoff="reduced-print-caution"]');
    expect(node?.className).toContain("bg-tag-amber");
    expect(node?.className).toContain("text-tag-amber-ink");
  });
});
