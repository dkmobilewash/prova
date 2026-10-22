import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ── CLICKING THE PLAN MUST TAKE THE KEYBOARD OFF THE NAME BOX ──
 *
 * The shortcut handler ignores keys typed into an INPUT, correctly: a
 * reviewer typing a filename should not accept a wall with every "a". But
 * focus STAYS in the name box after they type it, so the first click on the
 * drawing moves the highlight and the next N/A/R goes into the box. The
 * reviewer sees a candidate selected, their verdicts landing nowhere, and
 * their own name slowly filling up with "nanana".
 *
 * ── WHY THIS IS A SOURCE CHECK AND NOT A RENDER ──
 *
 * The bug is about `document.activeElement` after a real pointer event on an
 * SVG inside a scrolling, zooming canvas. happy-dom does no layout and its
 * focus model is not the browser's, so a render test here would assert
 * something that cannot fail — the vacuous green this repo keeps paying for.
 * What CAN be checked cheaply and honestly is that the blur is still wired to
 * pointer-down, which is the one line that was missing. The behaviour itself
 * was verified in a real browser when it was written.
 */
const VIEWER = readFileSync(
  join(__dirname, "..", "..", "components", "TakeoffPlanViewer.tsx"),
  "utf8",
);

/** Comments stripped: this file documents its own fix, and a census that
 *  reads prose finds the explanation instead of the code. */
const CODE = VIEWER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the plan takes the keyboard when it is clicked", () => {
  it("blurs a focused input on pointer-down", () => {
    const handler = CODE.slice(
      CODE.indexOf("const onPointerDown"),
      CODE.indexOf("const onPointerDown") + 1200,
    );
    expect(handler, "onPointerDown was not found at all").not.toBe("");
    expect(handler).toContain("document.activeElement");
    expect(handler).toContain(".blur()");
  });

  it("blurs only a TEXT field, so a focused button is left alone", () => {
    // Blurring whatever has focus would fight the browser on every click of
    // a toolbar button, and a button that loses focus mid-click does not fire
    // its keyboard activation.
    const handler = CODE.slice(
      CODE.indexOf("const onPointerDown"),
      CODE.indexOf("const onPointerDown") + 1200,
    );
    expect(handler).toContain("INPUT");
    expect(handler).toContain("TEXTAREA");
    expect(handler).toContain("isContentEditable");
  });

  it("is on the SVG itself, where a click on a candidate line reaches it", () => {
    // Candidate lines do not stop pointer-down, so it bubbles. Only the
    // vertex handle stops it, and that is shape editing rather than review.
    expect(CODE).toContain("onPointerDown={onPointerDown}");
    const stoppers = CODE.match(/onPointerDown=\{\(event\) => \{\s*event\.stopPropagation\(\)/g) ?? [];
    expect(
      stoppers.length,
      "something new stops pointer-down; check a click on a candidate still blurs",
    ).toBeLessThanOrEqual(1);
  });

  it("the shortcut handler still refuses keys typed into a field", () => {
    // The other half of the pair. If this ever goes, typing a name accepts a
    // wall per keystroke — which is why the blur is the fix rather than
    // loosening this.
    const panel = readFileSync(
      join(__dirname, "..", "..", "components", "AnswerKeyPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain('target.tagName === "INPUT"');
    expect(panel).toContain("if (typing");
  });
});
