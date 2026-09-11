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

/** The grounds text sits on: the page canvas (#0f0f0f), a card (#1a1a1a),
 * and the chrome (#171717 rail/topbar, shared with the mobile drawer).
 *
 * Dark (2026-09-11, same day the light palette landed): the founder chose
 * the dark "MainVision / Money Rail" mockups for filming, so the canvas
 * and card are no longer the same colour — cards lift from the page with
 * a #1a1a1a fill AND a #3d3d3d outline. The loops below therefore assert
 * genuinely different things per ground now, which is what the two-loop
 * shape was waiting for. */
const GROUNDS = [
  ["canvas", colors.canvas],
  ["surface", colors.surface],
  ["rail", colors.rail],
] as const;

describe("theme contrast", () => {
  it("computes a known ratio correctly", () => {
    // Black on white is 21:1 by definition — a check on the checker.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("pins the exact palette the founder approved", () => {
    // The dark mockup values, verbatim. If a token drifts, this names it.
    expect(colors.canvas).toBe("#0f0f0f");
    expect(colors.surface).toBe("#1a1a1a");
    expect(colors["line-card"]).toBe("#3d3d3d");
    expect(colors.rail).toBe("#171717");
    expect(colors["rail-hover"]).toBe("#262626");
    expect(colors.ink).toBe("#fafafa");
    expect(colors["ink-body"]).toBe("#d4d4d4");
    expect(colors["ink-muted"]).toBe("#a3a3a3");
    expect(colors.brand).toBe("#facc15");
    expect(colors.link).toBe("#eab308");
  });

  /** Text that carries meaning. 4.5:1 is the AA floor for normal text, and
   * every one of these levels is used at 10-14px.
   *
   * Measured (this file computes them; the comment is for the reviewer):
   *   ink       #fafafa — 18.4 on canvas, 16.7 on surface
   *   ink-label #e5e5e5 — 15.2 on canvas, 13.8 on surface
   *   ink-body  #d4d4d4 — 12.9 on canvas, 11.8 on surface
   */
  for (const level of ["ink", "ink-label", "ink-body"] as const) {
    for (const [groundName, ground] of GROUNDS) {
      it(`reads ${level} on ${groundName}`, () => {
        expect(contrastRatio(colors[level], ground)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  /** Optional text — placeholders and disabled controls. Held to 3:1
   * rather than 4.5, but held to something: "optional" is not "invisible".
   * ink-muted #a3a3a3 actually measures 7.6 on canvas / 6.9 on surface —
   * the dark ramp has far more headroom than the light one did. */
  for (const [groundName, ground] of GROUNDS) {
    it(`reads ink-muted on ${groundName}`, () => {
      expect(contrastRatio(colors["ink-muted"], ground)).toBeGreaterThanOrEqual(3);
    });
  }

  /** Tag pairs are a ground and an ink used only together.
   * tag-rose-ink #f97066 on #3a1518 — 5.8; tag-amber-ink #f0c464 on
   * #3a2a08 — 8.4; tag-green-ink #7ee2a8 on #143a26 — 8.0; tag-blue-ink
   * #422006 on #facc15 — 9.5 (the one light-ground pair: a brand fill
   * keeps its dark label); tag-slate-ink #9fb6c9 on #23282f — 7.1. */
  it("reads every tag ink on its own tag ground", () => {
    for (const [name, value] of Object.entries(colors)) {
      if (!name.startsWith("tag-") || !name.endsWith("-ink")) continue;
      const ground = colors[name.replace(/-ink$/, "")];
      expect(ground, `${name} has no matching ground`).toBeDefined();
      expect(contrastRatio(value, ground), `${name} on its ground`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("fails on a value that does not clear the floor, so these can fail", () => {
    // A mid grey is unreadable on this canvas exactly as a light grey was
    // on the white one. #404040 is the old light theme's ink-body — on
    // this canvas it is a border colour, not a text colour. If this ever
    // clears 3 the maths is wrong.
    expect(contrastRatio("#404040", colors.canvas)).toBeLessThan(3);
  });

  it("carries a readable dark label on the brand fill, and readable links", () => {
    // The brand yellow CANNOT carry white text (1.5:1) — every brand fill
    // carries a #171717 label at 600-700 weight (9.5:1), which is why the
    // buttons were moved off text-ink-label to text-neutral-900 in the
    // dark flip: ink-label is light now, and light-on-yellow is the one
    // combination this palette forbids in both themes.
    expect(contrastRatio("#ffffff", colors.brand)).toBeLessThan(3);
    expect(contrastRatio("#171717", colors.brand)).toBeGreaterThanOrEqual(4.5);
    // Links are the gold #eab308 — 10.0 on canvas, 9.1 on surface.
    // Yellow-on-dark reads; the darkened gold the light theme needed is
    // gone. Hover brightens to the brand yellow (12.5 on canvas).
    expect(contrastRatio(colors.link, colors.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.link, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors["link-hover"], colors.canvas)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps chip and hover lifts visible against their grounds", () => {
    // The dark theme separates surfaces by lift, not outline alone:
    // canvas #0f0f0f -> rail #171717 -> surface #1a1a1a -> hover #262626.
    // These are deliberately subtle, so assert the ORDER (each step
    // strictly brighter), not a contrast floor a 1.1:1 lift can never meet.
    const steps = ["canvas", "rail", "surface", "rail-hover"] as const;
    for (let i = 0; i < steps.length - 1; i += 1) {
      expect(
        luminance(colors[steps[i + 1]]),
        `${steps[i + 1]} should sit above ${steps[i]}`,
      ).toBeGreaterThan(luminance(colors[steps[i]]));
    }
    // And the card outline must be visibly distinct from the card itself.
    expect(contrastRatio(colors["line-card"], colors.surface)).toBeGreaterThanOrEqual(1.5);
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
