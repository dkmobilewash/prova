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
 * These were light and are now dark — the tokens were repointed so the
 * one converted page stops reading as a different application beside the
 * other 24. The assertions below are unchanged in intent and did not need
 * relaxing: every level clears the same floor it did before, with more
 * headroom than the light ramp had. */
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
    // A mid grey is unreadable on this canvas exactly as it was on the
    // light one. If this ever clears 3 the maths is wrong.
    expect(contrastRatio("#3a4354", colors.canvas)).toBeLessThan(3);
  });

  it("carries a readable white label on the brand fill", () => {
    // A button label is text, not decoration, so it answers to 4.5:1 —
    // and this is the assertion that would have caught me picking the
    // bolder blue by eye. brand is a fill and clears the 3:1 component
    // floor on the canvas; the label on top of it has to clear 4.5.
    expect(contrastRatio("#ffffff", colors.brand)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.brand, colors.canvas)).toBeGreaterThanOrEqual(3);
  });

  /**
   * THE TEST ABOVE MEASURES A COLOUR NOBODY IS OBLIGED TO USE.
   *
   * It proves white-on-brand clears 4.5:1. It says nothing about whether the
   * buttons in this app actually put white on brand — and the moment one of
   * them does not, that assertion is measuring a pairing that is not on
   * screen. A token test that is never tied back to the markup is a fact
   * about the config file.
   *
   * `bg-brand` is blue-600 (#2563eb), a DARK fill, and its whole ramp was
   * chosen that way: the tailwind config records that blue-500 was rejected
   * because its white label came out at 3.7:1. A dark label on it measures
   * 3.47:1 — under the 4.5 floor, and on this app's most-clicked buttons.
   *
   * This branch shipped exactly that, twice, on the two biggest buttons of
   * the feature being filmed ("Choose a folder" and "Confirm all N"):
   * `bg-brand … text-neutral-900`, copied from a palette note that describes
   * a yellow brand this repo does not have. Typecheck, lint and every other
   * test were green — a class name is a string.
   *
   * SIZE-ASSERTED, because the parse derives its own set: a regex that
   * stopped matching would find no offenders and pass. The floor is a floor
   * rather than an equality so adding a brand button does not fail a test
   * about contrast, but a parse that collapses to nothing fails loudly.
   */
  it("puts the white label it measured on every brand fill in the app", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, relative } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const appDir = fileURLToPath(new URL("..", import.meta.url));
    const tsx = (dir: string, out: string[] = []) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) tsx(full, out);
        else if (name.endsWith(".tsx")) out.push(full);
      }
      return out;
    };
    // Comments stripped for the same reason rowActionsCensus.test.ts strips
    // them: a paragraph explaining a class name is not a class name, and a
    // scan that reads its own documentation answers nothing.
    const withoutComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    // A single class string — quotes and backticks, never across a newline,
    // so one className cannot swallow the next.
    const CLASS_STRING_WITH_BRAND = /(["`])([^"`\n]*\bbg-brand\b[^"`\n]*)\1/g;

    const found: { path: string; classes: string }[] = [];
    for (const full of tsx(appDir)) {
      const code = withoutComments(readFileSync(full, "utf8"));
      for (const match of code.matchAll(CLASS_STRING_WITH_BRAND)) {
        found.push({ path: relative(appDir, full), classes: match[2] });
      }
    }

    expect(
      found.length,
      "the scan found almost no bg-brand at all — the pattern has stopped matching, " +
        "and a check that parses nothing passes everything below it",
    ).toBeGreaterThanOrEqual(6);

    const offenders = found
      .filter((f) => !/\btext-white\b/.test(f.classes))
      .map((f) => `${f.path}: ${f.classes.trim()}`);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "",
            "A bg-brand fill is carrying a label that is not text-white.",
            "",
            "brand is blue-600 — a DARK fill. White on it is 5.17:1; the",
            "text-neutral-900 that a light/yellow brand would want measures",
            "3.47:1, under the 4.5 floor a button label answers to.",
            "",
            "Use text-white, which is what the assertion above this one",
            "actually measured and what every other brand button in the app",
            "already does.",
            "",
          ].join("\n"),
    ).toEqual([]);
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
