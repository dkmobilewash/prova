import { describe, expect, it } from "vitest";
import config from "../tailwind.config";

/** WCAG relative luminance and contrast ratio.
 *
 * This exists because a colour token cannot be reviewed by looking at it.
 * The light theme shipped with a muted grey at 2.4:1 that was carrying
 * stat-tile labels and invoice due dates — text that names a number or IS
 * the number. It read as "subtle" in the editor and as unreadable on a
 * screen, and no typecheck, lint or build had anything to say about it.
 */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const colors = (config.theme?.extend?.colors ?? {}) as Record<string, string>;

/** The two grounds light text sits on: the page canvas and a card. */
const GROUNDS = [
  ["canvas", colors.canvas],
  ["surface", colors.surface],
] as const;

describe("light theme contrast", () => {
  it("computes a known ratio correctly", () => {
    // Black on white is 21:1 by definition — a check on the checker.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  /** Text that carries meaning. 4.5:1 is the AA floor for normal text, and
   * every one of these levels is used at 10-14px. */
  for (const level of ["ink", "ink-label", "ink-body"] as const) {
    for (const [groundName, ground] of GROUNDS) {
      it(`reads ${level} on ${groundName}`, () => {
        expect(contrastRatio(colors[level], ground)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  /** Optional text — placeholders and disabled controls. Held to 3:1
   * rather than 4.5, but held to something: "optional" is not "invisible". */
  for (const [groundName, ground] of GROUNDS) {
    it(`reads ink-muted on ${groundName}`, () => {
      expect(contrastRatio(colors["ink-muted"], ground)).toBeGreaterThanOrEqual(3);
    });
  }

  /** Tag pairs are a ground and an ink used only together. */
  it("reads every tag ink on its own tag ground", () => {
    for (const [name, value] of Object.entries(colors)) {
      if (!name.startsWith("tag-") || !name.endsWith("-ink")) continue;
      const ground = colors[name.replace(/-ink$/, "")];
      expect(ground, `${name} has no matching ground`).toBeDefined();
      expect(contrastRatio(value, ground), `${name} on its ground`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("fails when a token is too light, so these assertions can fail", () => {
    // The value that shipped. If this ever clears 4.5 the maths is wrong.
    expect(contrastRatio("#98a2b3", colors.canvas)).toBeLessThan(3);
  });
});
