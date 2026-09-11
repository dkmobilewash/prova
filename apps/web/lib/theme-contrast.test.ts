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

/** The two grounds text sits on: the page canvas and a card.
 *
 * Light again (2026-09-11): the yellow/black/white palette from the
 * approved mockups. Both grounds are white — cards separate from the
 * page with 1px black outlines, not with a different fill — so the two
 * loops below currently assert the same thing twice. They stay as two
 * on purpose: the day surface stops being white, the card assertions
 * are already here. */
const GROUNDS = [
  ["canvas", colors.canvas],
  ["surface", colors.surface],
] as const;

describe("theme contrast", () => {
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

  it("fails on a value that does not clear the floor, so these can fail", () => {
    // A light grey is unreadable on this canvas exactly as a mid grey
    // was on the dark one. If this ever clears 3 the maths is wrong.
    expect(contrastRatio("#cbd5e1", colors.canvas)).toBeLessThan(3);
  });

  it("carries a readable dark label on the brand fill, and readable links", () => {
    // The brand yellow CANNOT carry white text (1.5:1) and does not
    // itself clear the 3:1 component floor on the white canvas — that is
    // the approved design: every brand fill carries a #171717 label at
    // 600-700 weight, and the label is what answers to 4.5:1. If someone
    // ever puts text-white back on bg-brand, the first assertion is the
    // one that documents why it was wrong.
    expect(contrastRatio("#ffffff", colors.brand)).toBeLessThan(3);
    expect(contrastRatio("#171717", colors.brand)).toBeGreaterThanOrEqual(4.5);
    // Links are the dark gold, not the brand yellow, precisely so they
    // read as text on the white canvas.
    expect(contrastRatio(colors.link, colors.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors["link-hover"], colors.canvas)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps all four ink levels distinguishable from each other", () => {
    // The light ramp could only afford three informational greys; the
    // fourth was hierarchy bought with legibility. The dark ramp has room
    // for four, but only if they are actually different — a ramp whose
    // levels collapse is a ramp that has stopped doing its job.
    const ramp = ["ink", "ink-label", "ink-body", "ink-muted"] as const;
    for (let i = 0; i < ramp.length - 1; i += 1) {
      const brighter = contrastRatio(colors[ramp[i]], colors.canvas);
      const dimmer = contrastRatio(colors[ramp[i + 1]], colors.canvas);
      expect(brighter, `${ramp[i]} should read brighter than ${ramp[i + 1]}`).toBeGreaterThan(
        dimmer,
      );
    }
  });
});
