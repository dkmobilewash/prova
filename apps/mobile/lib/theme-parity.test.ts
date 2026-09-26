import { describe, expect, it } from "vitest";
import { palettes, radius, shadow, space, typography } from "./theme";

/**
 * The palettes are two sets of VALUES over one vocabulary. The moment the
 * vocabularies drift — a token added to light and forgotten in dark, or
 * renamed in one — half the app silently falls back to defaults on the
 * other half's screens, and no contrast test sees it because it asserts
 * whatever the palette happens to hold.
 *
 * This is the census-half of that guard: identical keys, and the shared
 * static tokens (typography/space/radius/shadow) are genuinely shared —
 * mode-independent by design, since a 4-pt grid and a 44pt target do not
 * change with the wallpaper.
 */
describe("the palettes are one vocabulary", () => {
  it("defines the identical colour keys in every palette", () => {
    // Derived rather than named: `outdoor` joined light and dark on
    // 2026-09-26 and this test compared exactly two palettes, so the new
    // one's vocabulary was checked by nothing.
    const modes = Object.keys(palettes) as (keyof typeof palettes)[];
    expect(modes.length).toBeGreaterThanOrEqual(3);
    const light = Object.keys(palettes.light.colors).sort();
    for (const mode of modes) {
      expect(Object.keys(palettes[mode].colors).sort(), `${mode} drifted`).toEqual(light);
    }
  });

  it("keeps the static tokens mode-independent", () => {
    // The shared tokens must exist and be numbers/strings — a screen that
    // switches palettes must never also switch its grid or its type scale.
    for (const [name, value] of Object.entries(typography.size)) {
      expect(typeof value, `typography.size.${name}`).toBe("number");
    }
    for (const [name, value] of Object.entries(space)) {
      expect(typeof value, `space.${name}`).toBe("number");
    }
    for (const [name, value] of Object.entries(radius)) {
      expect(typeof value, `radius.${name}`).toBe("number");
    }
    expect(typeof shadow.floating.shadowOpacity).toBe("number");
    expect(typeof shadow.floating.elevation).toBe("number");
  });

  it("keeps the brand fill identical across palettes", () => {
    // `brand` is the product identity; if the two modes ever disagree on
    // which yellow the founder approved, that is a bug, not a choice.
    for (const mode of Object.keys(palettes) as (keyof typeof palettes)[]) {
      expect(palettes[mode].colors.brand, `${mode} brand`).toBe(palettes.light.colors.brand);
      expect(palettes[mode].colors.brandInk, `${mode} brandInk`).toBe(palettes.light.colors.brandInk);
    }
  });
});
