import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cardSurface, palettes, shadow } from "./theme";

/**
 * A CARD IS LIFTED WHERE A SHADOW CAN BE SEEN AND OUTLINED WHERE IT CANNOT,
 * and `cardSurface` is the only thing that decides which.
 *
 * The app drew every surface as a 1px outline on a canvas ~4% away from it,
 * which is to say the outline was doing all the separating alone — and the
 * result read as a page of boxes rather than cards on a page. Canvas moved
 * to #e5e7ee and surfaces gained `shadow.card`.
 *
 * **The `outdoor` palette must NOT get that shadow**, and that is the whole
 * reason this file exists rather than a comment. A soft shadow is the first
 * thing direct sunlight destroys, so in glare a card is told apart by its
 * BORDER — which is why `lineCard` there is `#6b6b6b` rather than a
 * hairline. Elevating outdoor would spend the one cue those users have on
 * decoration none of them can see, and it is exactly the kind of thing a
 * later "make the palettes consistent" tidy-up would do.
 *
 * WHAT THIS IS NOT. It does not census every hand-rolled border in the app.
 * Nine files pair `surface` with `lineCard` and most are CONTROLS — Chip,
 * Button, Field, the way-home button — which keep their outlines on
 * purpose: a control is meant to read as a thing you press, not as paper. A
 * blanket "no hand-rolled surfaces" rule would be a false-positive machine,
 * and a census that cries wolf gets its exceptions list padded until it
 * means nothing. So this asserts the CONTRACT and the two shared surfaces
 * that carry it.
 */

const COMPONENTS = join(__dirname, "..", "components");

function source(file: string): string {
  return readFileSync(join(COMPONENTS, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("cardSurface decides depth, and outdoor stays flat", () => {
  it("gives a lifted palette a shadow and no border", () => {
    for (const mode of ["light", "dark"] as const) {
      const style = cardSurface(palettes[mode]) as Record<string, unknown>;
      expect(palettes[mode].depth, `${mode} should be lifted`).toBe("lifted");
      expect(style.shadowOpacity, `${mode} card has no shadow`).toBe(shadow.card.shadowOpacity);
      expect(style.elevation, `${mode} card has no android elevation`).toBe(shadow.card.elevation);
      expect(
        style.borderWidth,
        `${mode} card has BOTH a shadow and a border — that reads as a box someone drew a shadow ` +
          `under, which is the look this replaced`,
      ).toBeUndefined();
    }
  });

  it("gives the outdoor palette a border and no shadow", () => {
    const style = cardSurface(palettes.outdoor) as Record<string, unknown>;
    expect(palettes.outdoor.depth).toBe("flat");
    expect(style.borderWidth, "outdoor card has no border — in glare that is the only cue").toBe(1);
    expect(style.borderColor).toBe(palettes.outdoor.colors.lineCard);
    expect(
      style.shadowOpacity,
      "the outdoor palette was given a shadow. Direct sun destroys it, and it is bought with the " +
        "border that is the only thing those users can actually see.",
    ).toBeUndefined();
  });

  it("always paints the surface and rounds the corner, whichever branch", () => {
    // The half that is the same either way. A branch that forgot the
    // background would render a transparent card on the canvas, which looks
    // like a spacing bug rather than a missing fill.
    for (const mode of Object.keys(palettes) as (keyof typeof palettes)[]) {
      const style = cardSurface(palettes[mode]) as Record<string, unknown>;
      expect(style.backgroundColor, `${mode} card has no fill`).toBe(palettes[mode].colors.surface);
      expect(typeof style.borderRadius, `${mode} card has no radius`).toBe("number");
    }
  });

  it("covers every palette, so a fourth one cannot arrive undecided", () => {
    // SCOPE. `outdoor` joined light and dark on 2026-09-26 and the parity
    // test at the time compared exactly two palettes, so the new one's
    // vocabulary was checked by nothing. Same trap, one field further on:
    // a palette with no `depth` would fall to the flat branch silently.
    const modes = Object.keys(palettes) as (keyof typeof palettes)[];
    expect(modes.length).toBeGreaterThanOrEqual(3);
    for (const mode of modes) {
      expect(["lifted", "flat"], `${mode} declares no usable depth`).toContain(palettes[mode].depth);
    }
  });

  it("keeps the two shared surfaces on the helper rather than hand-rolled", () => {
    // Card and GroupedList are what nearly every screen renders through, so
    // un-lifting either by hand would undo this everywhere at once while
    // looking like a local tweak.
    for (const file of ["Card.tsx", "GroupedList.tsx"]) {
      const text = source(file);
      expect(text, `${file} no longer calls cardSurface`).toContain("cardSurface(p)");
      expect(
        text,
        `${file} hand-rolls a border again — that bypasses the outdoor/lifted decision`,
      ).not.toMatch(/borderColor:\s*p\.colors\.lineCard/);
    }
  });

  it("keeps the card shadow softer than the floating one", () => {
    // A list of cards must read as paper, not as a stack of buttons. If
    // these ever converge, the page gets loud and the floating capture
    // button stops being the one thing that is obviously above everything.
    expect(shadow.card.shadowOpacity).toBeLessThan(shadow.floating.shadowOpacity);
    expect(shadow.card.elevation).toBeLessThan(shadow.floating.elevation);
    expect(shadow.card.shadowRadius).toBeLessThan(shadow.floating.shadowRadius);
  });
});
