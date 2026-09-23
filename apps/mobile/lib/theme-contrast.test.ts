import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { palettes, type Palette } from "./theme";

/**
 * Every colour pair this app actually renders, checked against WCAG — now
 * for BOTH palettes.
 *
 * The web has `theme-contrast.test.ts` for the same reason and learned the
 * hard way what happens without one: a shared button shipped white text on
 * the founder yellow at 1.53:1, on nine pages, with the tailwind config
 * saying "Never put white text on this" three lines above the token.
 *
 * Flipping or ADDING a palette is exactly when contrast quietly breaks —
 * every ink that was chosen against one ground now sits on another — so
 * the pairs are asserted here rather than eyeballed on one phone in one
 * room. The light palette is new (2026-09-21, the Apple-HIG redesign);
 * its values were chosen against these floors, not inherited.
 *
 * The thresholds are WCAG AA: 4.5:1 for body text, and primary text is
 * held to 7:1 (AAA) because the screen it runs on is outdoors. One floor
 * differs per palette on purpose: `link` holds 7:1 on the DARK canvas
 * (gold text chosen for outdoor glare) and 4.5:1 on the LIGHT one, where
 * an amber that clears 7:1 on near-white would have to be so brown it
 * stops reading as a link at all.
 */

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** ink, ground, floor — named the way the app uses them. The dark palette
 * holds `link` on canvas to 7:1; every other pair shares the same floors
 * across palettes, which is the parity that matters more than the values. */
function pairsFor(palette: Palette, linkFloor: number): [string, string, string, number][] {
  const c = palette.colors;
  return [
    ["ink on canvas", c.ink, c.canvas, 7],
    ["ink on surface", c.ink, c.surface, 7],
    ["ink on rail", c.ink, c.rail, 7],
    ["inkLabel on surface", c.inkLabel, c.surface, 4.5],
    ["inkBody on canvas", c.inkBody, c.canvas, 4.5],
    ["inkBody on surface", c.inkBody, c.surface, 4.5],
    ["inkMuted on surface", c.inkMuted, c.surface, 4.5],
    ["link on canvas", c.link, c.canvas, linkFloor],
    ["link on surface", c.link, c.surface, 4.5],
    ["linkHover on canvas", c.linkHover, c.canvas, 4.5],
    ["brandInk on brand", c.brandInk, c.brand, 4.5],
    ["tagRoseInk on tagRose", c.tagRoseInk, c.tagRose, 4.5],
    ["tagAmberInk on tagAmber", c.tagAmberInk, c.tagAmber, 4.5],
    ["tagGreenInk on tagGreen", c.tagGreenInk, c.tagGreen, 4.5],
    ["tagBlueInk on tagBlue", c.tagBlueInk, c.tagBlue, 4.5],
    ["tagSlateInk on tagSlate", c.tagSlateInk, c.tagSlate, 4.5],
    ["tagBrandSoftInk on tagBrandSoft", c.tagBrandSoftInk, c.tagBrandSoft, 4.5],
  ];
}

for (const [mode, palette, linkFloor] of [
  ["dark", palettes.dark, 7],
  ["light", palettes.light, 4.5],
] as const) {
  const PAIRS = pairsFor(palette, linkFloor);

  describe(`what the phone renders is readable — ${mode}`, () => {
    for (const [name, ink, ground, floor] of PAIRS) {
      it(`${name} clears ${floor}:1`, () => {
        expect(Number(contrast(ink, ground).toFixed(2))).toBeGreaterThanOrEqual(floor);
      });
    }

    it("keeps the brand yellow off text colours entirely", () => {
      // The mistake the web made once and this palette makes easy: `brand` is
      // a FILL. As text it sits at 1.5:1 on its own fill and under 2:1 on a
      // light tag ground. `link` is the amber that is safe as text.
      expect(contrast(palette.colors.brand, palette.colors.tagBlue)).toBeLessThan(2);
      expect(contrast(palette.colors.link, palette.colors.canvas)).toBeGreaterThanOrEqual(linkFloor);
    });
  });

  describe(`the census can see everything it is reasoning about — ${mode}`, () => {
    it("asserts a floor for every ink token the palette defines", () => {
      const asserted = new Set(PAIRS.flatMap(([, ink, ground]) => [ink, ground]));
      const inkTokens = Object.entries(palette.colors)
        .filter(([name]) => /^(ink|link|brandInk|tag\w*Ink)/.test(name))
        .map(([, value]) => value);

      const missing = inkTokens.filter((value) => !asserted.has(value));
      expect(
        missing,
        `these ${mode} ink colours are rendered but never contrast-checked: ${missing.join(", ")}`,
      ).toEqual([]);
    });
  });
}

describe("the census can see everything it is reasoning about — scope", () => {
  it("finds no colour defined outside the palette in a screen or component", () => {
    // A hardcoded hex is a colour the palettes cannot reach, so it stays
    // light while everything around it goes dark (or vice versa). The
    // allowed ones are not theme colours at all: white burned into a photo
    // stamp, and the signature pad's paper and pen.
    const root = join(__dirname, "..");
    const files = [
      ...listFiles(join(root, "app")),
      ...listFiles(join(root, "components")),
    ].filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of files) {
      if (file.includes("SignaturePad") || file.includes("photos/")) continue;
      const text = readFileSync(file, "utf8");
      // QUOTED hexes only: a colour that renders is a string literal.
      // The first cut of this matched prose too and failed on a comment
      // explaining which two greys the chrome uses — a census that fails on
      // its own documentation gets deleted by the next person in a hurry.
      for (const match of text.matchAll(/["']#[0-9a-fA-F]{6}["']/g)) {
        offenders.push(`${file.slice(root.length + 1)}: ${match[0]}`);
      }
    }
    expect(offenders, `colours outside lib/theme.ts: ${offenders.join(", ")}`).toEqual([]);
  });
});

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}
