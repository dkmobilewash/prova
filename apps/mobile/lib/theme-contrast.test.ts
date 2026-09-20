import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { colors } from "./theme";

/**
 * Every colour pair this app actually renders, checked against WCAG.
 *
 * The web has `theme-contrast.test.ts` for the same reason and learned the
 * hard way what happens without one: a shared button shipped white text on
 * the founder yellow at 1.53:1, on nine pages, with the tailwind config
 * saying "Never put white text on this" three lines above the token.
 *
 * The phone went from a light palette to the web's dark one on 2026-09-20.
 * Flipping a palette is exactly when contrast quietly breaks — every ink
 * that was chosen against white is now on #0f0f0f — so the pairs are
 * asserted here rather than eyeballed on one phone in one room.
 *
 * The thresholds are WCAG AA: 4.5:1 for body text, and this file holds
 * primary text to 7:1 (AAA) because the screen it runs on is outdoors.
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

/** ink, ground, floor — named the way the app uses them. */
const PAIRS: [string, string, string, number][] = [
  ["ink on canvas", colors.ink, colors.canvas, 7],
  ["ink on surface", colors.ink, colors.surface, 7],
  ["ink on rail", colors.ink, colors.rail, 7],
  ["inkLabel on surface", colors.inkLabel, colors.surface, 4.5],
  ["inkBody on canvas", colors.inkBody, colors.canvas, 4.5],
  ["inkBody on surface", colors.inkBody, colors.surface, 4.5],
  ["inkMuted on surface", colors.inkMuted, colors.surface, 4.5],
  ["link on canvas", colors.link, colors.canvas, 4.5],
  ["link on surface", colors.link, colors.surface, 4.5],
  ["brandInk on brand", colors.brandInk, colors.brand, 4.5],
  ["tagRoseInk on tagRose", colors.tagRoseInk, colors.tagRose, 4.5],
  ["tagAmberInk on tagAmber", colors.tagAmberInk, colors.tagAmber, 4.5],
  ["tagGreenInk on tagGreen", colors.tagGreenInk, colors.tagGreen, 4.5],
  ["tagBlueInk on tagBlue", colors.tagBlueInk, colors.tagBlue, 4.5],
  ["tagSlateInk on tagSlate", colors.tagSlateInk, colors.tagSlate, 4.5],
  ["tagBrandSoftInk on tagBrandSoft", colors.tagBrandSoftInk, colors.tagBrandSoft, 4.5],
];

describe("what the phone renders is readable", () => {
  for (const [name, ink, ground, floor] of PAIRS) {
    it(`${name} clears ${floor}:1`, () => {
      expect(Number(contrast(ink, ground).toFixed(2))).toBeGreaterThanOrEqual(floor);
    });
  }

  it("keeps the brand yellow off text colours entirely", () => {
    // The mistake the web made once and this palette makes easy: `brand` is
    // a FILL. As text it sits at 1.5:1 on its own fill and under 2:1 on a
    // light tag ground. `link` is the gold that is safe as text here.
    expect(contrast(colors.brand, colors.tagBlue)).toBeLessThan(2);
    expect(contrast(colors.link, colors.canvas)).toBeGreaterThan(7);
  });
});

/**
 * The scope half of the check — the other failure mode a census has, and
 * the one no threshold can see: asking the right question about the wrong
 * set. `theme.ts` is the only place colours are allowed to come from, so
 * this counts what is defined there against what is asserted above.
 */
describe("the census can see everything it is reasoning about", () => {
  it("asserts a floor for every ink token the palette defines", () => {
    const asserted = new Set(PAIRS.flatMap(([, ink, ground]) => [ink, ground]));
    const inkTokens = Object.entries(colors)
      .filter(([name]) => /^(ink|link|brandInk|tag\w*Ink)/.test(name))
      .map(([, value]) => value);

    const missing = inkTokens.filter((value) => !asserted.has(value));
    expect(missing, `these ink colours are rendered but never contrast-checked: ${missing.join(", ")}`).toEqual([]);
  });

  it("finds no colour defined outside the palette in a screen or component", () => {
    // A hardcoded hex is a colour the flip above cannot reach, so it stays
    // light while everything around it goes dark. The four allowed ones are
    // not theme colours at all: white burned into a photo stamp, and the
    // signature pad's paper and pen.
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
