import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A PIN IS ONLY WORTH PLACING IF IT CAN BE PLACED ACCURATELY.
 *
 * Measured rather than felt. A D-size sheet is 42 inches wide and renders
 * inline at about 350pt, so a gloved fingertip (±8–10pt) is roughly 1.2 inches
 * of paper — **about ten feet in the building at 1/8" = 1'-0"**, or five at
 * 1/4". That locates a room, not a wall. A foreman handed a ten-foot circle
 * twice stops using the feature, which makes zoom the thing the whole screen
 * turns on rather than a refinement.
 *
 * **WHAT THIS FILE CANNOT DO.** It cannot prove anything zooms, and it cannot
 * prove a pin lands where the finger went. The screen suite runs in happy-dom:
 * no layout, no pinch, `getBoundingClientRect` returns zeros. This is a
 * presence census, like the keyboard one beside it, and the verdict comes from
 * a phone.
 *
 * What it does hold is the two structural decisions that are easy to undo by
 * accident: one definition of the tap, and no nested scroll view.
 */

const SCREEN = join(__dirname, "..", "app", "sheets", "[jobId].tsx");

function code(): string {
  return readFileSync(SCREEN, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("the sheet can be zoomed before a pin is placed", () => {
  it("offers a zoomable full-screen view", () => {
    const text = code();
    expect(text, "the full-screen sheet is gone — a tap is back to ~ten feet").toMatch(/<Modal[\s\S]{0,200}visible=\{full\}/);
    expect(text, "the full-screen sheet no longer zooms").toMatch(/maximumZoomScale=\{\d+\}/);
  });

  it("ONE definition of where a tap lands, used by both surfaces", () => {
    const text = code();
    // The decisive structural rule. Two copies is how the inline sheet and the
    // full-screen one start disagreeing about where a pin goes — and a pin
    // that lands somewhere else is worse than no pin at all.
    const divisions = text.match(/locationX \/ /g) ?? [];
    expect(
      divisions.length,
      "the tap maths is written more than once. Both surfaces must go through place(), or they will " +
        "drift and a pin placed in one will not match the other.",
    ).toBe(1);

    const callers = text.match(/place\(e\.nativeEvent\.locationX, e\.nativeEvent\.locationY, [a-zA-Z.]+\)/g) ?? [];
    expect(callers.length, "both the inline and full-screen sheets must call the shared placer").toBe(2);
  });

  it("keeps y over the WIDTH, which is the whole coordinate system", () => {
    // `y` runs 0..H/W, not 0..1. A square test sheet cannot catch this being
    // wrong, which is why it is asserted in text rather than in a fixture.
    expect(code(), "the tap no longer divides both axes by the same width").toMatch(
      /setDraft\(\{ x: locationX \/ width, y: locationY \/ width \}\)/,
    );
  });

  it("does not nest the zoomable view inside the page's scroll view", () => {
    // Same-axis nesting: the pan gesture then belongs to whichever scroll view
    // wins, and which one that is depends on the platform. The Modal has no
    // parent scroll view, which is why it is a Modal.
    const text = code();
    const modalAt = text.indexOf("<Modal");
    const pageScrollEnd = text.lastIndexOf("</ScrollView>", modalAt);
    expect(modalAt, "no full-screen modal — this census is guarding nothing").toBeGreaterThan(-1);
    expect(
      pageScrollEnd,
      "the zoomable view moved inside the page's ScrollView. Same-axis nesting means the pan belongs " +
        "to whichever one wins, and panning a zoomed drawing is how you reach the part you want.",
    ).toBeLessThan(modalAt);
  });
});
