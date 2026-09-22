import { describe, expect, it } from "vitest";
import glyphMap from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json";
import { ICON_GLYPHS } from "./icon-glyphs";

/**
 * Every icon name the app uses exists in the font.
 *
 * A misspelt glyph does not throw, warn, or fail a typecheck — it renders
 * an empty box, and an empty box next to a label looks like a loading
 * state rather than a mistake. This is the cheapest possible check and it
 * is the only one that can see the difference.
 */

describe("the icon map", () => {
  const names = Object.entries(ICON_GLYPHS);

  it("has an outline and a filled glyph for every meaning", () => {
    expect(names.length).toBeGreaterThan(10);
    for (const [meaning, pair] of names) {
      expect(pair, `${meaning} needs [outline, filled]`).toHaveLength(2);
    }
  });

  it("names only glyphs the font actually carries", () => {
    const missing: string[] = [];
    for (const [meaning, pair] of names) {
      for (const glyph of pair) {
        if (!(glyph in glyphMap)) missing.push(`${meaning}: ${glyph}`);
      }
    }
    expect(missing, `not in Ionicons: ${missing.join(", ")}`).toEqual([]);
  });
});
