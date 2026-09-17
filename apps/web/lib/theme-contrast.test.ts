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

  /**
   * THE TEST ABOVE MEASURES A COLOUR NOBODY IS OBLIGED TO USE.
   *
   * It proves the label-on-brand pairing clears 4.5:1. It says nothing
   * about whether the buttons in this app actually use that pairing — and
   * the moment one of them does not, that assertion is measuring something
   * that is not on screen. A token test never tied back to the markup is a
   * fact about the config file.
   *
   * `bg-brand` is the founder-approved yellow (#facc15), a LIGHT fill, so
   * the label on it is DARK. Measured with the helper at the top of this
   * file rather than asserted from memory: `text-neutral-900` (#171717) on
   * brand is 11.71:1, and white on brand is **1.53:1** — not marginal,
   * unreadable.
   *
   * INVERTED 2026-09-14, and the inversion is the lesson rather than the
   * fix. This check arrived on `cyrus/document-intake`, a branch cut BEFORE
   * the theme flip, when brand was blue-600 (#2563eb) — a DARK fill whose
   * ramp was chosen for a white label, with blue-500 rejected at 3.7:1. On
   * that palette "every brand fill carries text-white" was exactly right,
   * and the branch had caught two real defects with it.
   *
   * The flip changed the token and not this test, and git merged the two
   * halves without a conflict: the file went on pinning `colors.brand` to
   * `#facc15` in one assertion while demanding a white label on it in the
   * next. Both halves were true when written. Satisfying the merged version
   * would have put 1.53:1 white text on every brand button in the app —
   * a test doing the precise opposite of its own purpose, with typecheck,
   * lint and 2900 other tests green, because a class name is a string.
   *
   * So: a contrast test must derive its expectation from the TOKEN, not
   * name a colour in prose. The assertion below reads `colors.brand` and
   * measures, so the next palette change fails here instead of inverting
   * here.
   *
   * SIZE-ASSERTED, because the parse derives its own set: a regex that
   * stopped matching would find no offenders and pass. The floor is a floor
   * rather than an equality so adding a brand button does not fail a test
   * about contrast, but a parse that collapses to nothing fails loudly.
   */
  it("puts the dark label it measured on every brand fill in the app", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, relative, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const appDir = fileURLToPath(new URL("..", import.meta.url));

    /* THE ROOTS COME FROM `content`, NOT FROM THIS FILE'S DIRECTORY, and that
     * is the whole correction of 2026-09-16.
     *
     * This scan walked `appDir` — `apps/web` — for a month. Every offender it
     * could name lived there, so it stayed green while
     * `packages/ui/src/Button.tsx` shipped `bg-brand text-white
     * hover:bg-blue-700`: white on #facc15 at 1.53:1, on the shared primary
     * button that nine pages import, the GC-facing portal among them.
     *
     * The size assertion below did not catch it and could not have. It guards
     * against the PATTERN breaking — a scan that suddenly matches nothing —
     * and this scan matched plenty. What was wrong was the SCOPE: the one
     * offending file was never a candidate, and nothing is ever missing from
     * a directory you do not walk. That is a second failure mode for a check
     * that derives its input, alongside the one CLAUDE.md already records.
     *
     * Tailwind's `content` is the authoritative list of files whose classes
     * reach this app — if a class is not in one of these globs it does not
     * render, and if it is, this census must see it. Deriving the roots from
     * it means adding a workspace package to `content` extends the census
     * with no edit here, which is the only version of this that stays true.
     */
    const globs = (Array.isArray(config.content) ? config.content : []) as string[];
    const roots = globs.map((glob) => {
      const star = glob.indexOf("*");
      return resolve(appDir, star === -1 ? glob : glob.slice(0, star));
    });

    expect(
      roots.length,
      "tailwind.config.ts declares no `content` globs, so this census would " +
        "scan nothing and pass everything below it",
    ).toBe(globs.length);
    expect(roots.length).toBeGreaterThanOrEqual(3);
    for (const root of roots) {
      expect(
        statSync(root).isDirectory(),
        `${root} is a content glob root that does not exist — the census cannot ` +
          `scan it, and a root that resolves to nothing removes files from this ` +
          `check without removing them from the build`,
      ).toBe(true);
    }

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
    //
    // `(?!\/)` excludes a SOFT fill. `bg-brand/15` is 15% yellow over the
    // page ground, which is a chip rather than a button, and the label that
    // belongs on it is `text-brand` — the opposite of the rule below.
    // MobileNav's active pill is the one in the app, and without this it
    // reads as an offender forever, which is how a census gets an exception
    // list instead of a fix.
    const CLASS_STRING_WITH_BRAND = /(["`])([^"`\n]*\bbg-brand\b(?!\/)[^"`\n]*)\1/g;

    const found: { path: string; classes: string }[] = [];
    for (const full of roots.flatMap((root) => tsx(root))) {
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

    // Derived from the token rather than hardcoded, so a future palette
    // change fails this test rather than silently inverting it.
    const onBrand = { white: contrastRatio("#ffffff", colors.brand), dark: contrastRatio("#171717", colors.brand) };
    expect(
      onBrand.dark,
      `text-neutral-900 on ${colors.brand} measures ${onBrand.dark.toFixed(2)}:1. If this has ` +
        `dropped below the floor, the brand token moved and the rule below is the one to revisit.`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      onBrand.white,
      `white on ${colors.brand} measures ${onBrand.white.toFixed(2)}:1 — if that ever clears 4.5 ` +
        `the brand has become a dark fill and this whole test should be checking for text-white.`,
    ).toBeLessThan(4.5);

    const offenders = found
      .filter((f) => !/\btext-neutral-900\b/.test(f.classes))
      .map((f) => `${f.path}: ${f.classes.trim()}`);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : [
            "",
            "A bg-brand fill is carrying a label that is not text-neutral-900.",
            "",
            "brand is the founder-approved yellow (#facc15) — a LIGHT fill.",
            "text-neutral-900 on it measures 11.71:1; white measures 1.53:1,",
            "which is not marginal, it is unreadable.",
            "",
            "Use text-neutral-900, which is what the two assertions directly",
            "above this one measure from the token itself, and what every",
            "other brand button in the app already does.",
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
