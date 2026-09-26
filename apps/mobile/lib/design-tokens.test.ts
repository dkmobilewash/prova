import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { space } from "./theme";

/**
 * The shape-and-source half of the token system — what theme-contrast is
 * to colours, this is to radii, spacing and the palette itself.
 *
 * Three censuses, all of the same family CLAUDE.md warns about: a check
 * that DERIVES its input can get the answer wrong or get an empty
 * question. Each one therefore asserts its own size against a source
 * that cannot drift with the pattern.
 *
 * 1. NO BARE `colors` IMPORT. The redesign's migration shim
 *    (`export const colors = palettes.dark.colors`) existed so screens
 *    could convert phase by phase. It is gone now; a screen importing it
 *    again would pin itself to the dark palette silently — exactly the
 *    bug the shim was for. The census fails on the import anywhere in
 *    app/ or components/.
 *
 * 2. NO RADIUS LITERALS. Corners come from `radius.*` — a screen that
 *    hardcodes 12 is a screen that disagrees with the next one about
 *    what a card looks like. SignaturePad is whitelisted (its paper is
 *    the same whitelist the hex census grants it); everything else must
 *    name a token.
 *
 * 3. GAPS ON THE SCALE. `gap` values must be one of the scale's own
 *    numbers — 2 is the segmented track's half-step, the rest are the
 *    4-pt grid. A gap of 7 or 13 is a spacing nobody can name, which is
 *    how two screens drift 1pt apart forever.
 */

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

const root = join(__dirname, "..");
const files = [...listFiles(join(root, "app")), ...listFiles(join(root, "components"))].filter(
  (f) => f.endsWith(".tsx") || f.endsWith(".ts"),
);

const GAP_SCALE = new Set(["2", "4", "8", "12", "16", "20", "24", "32"]);

describe("shapes and sources stay tokenised", () => {
  it("scans a real set of screens", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("lets no screen or component import the old colours shim", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (/import\s*\{[^}]*\bcolors\b[^}]*\}\s*from\s*["']@\/lib\/theme["']/.test(text)) {
        offenders.push(file.slice(root.length + 1));
      }
    }
    expect(
      offenders,
      `these files pin themselves to the dark palette instead of usePalette(): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("lets no screen or component hardcode a corner radius", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.includes("SignaturePad")) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/borderRadius:\s*\d+(?:\.\d+)?/g)) {
        offenders.push(`${file.slice(root.length + 1)}: ${match[0]}`);
      }
    }
    expect(offenders, `radii outside lib/theme.ts: ${offenders.join(", ")}`).toEqual([]);
  });

  it("keeps every gap on the 4-pt scale", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/gap:\s*(\d+)/g)) {
        if (!GAP_SCALE.has(match[1])) offenders.push(`${file.slice(root.length + 1)}: gap ${match[1]}`);
      }
    }
    expect(offenders, `off-scale gaps: ${offenders.join(", ")}`).toEqual([]);
  });

  /**
   * 3b. PADDING AND MARGIN COME FROM THE SCALE TOO.
   *
   * The gap rule above has been here since the tokens were written and
   * it only ever read `gap:` — so `padding`/`margin` drifted freely
   * underneath it: **91 bare numbers** across 20 files when this was
   * added on 2026-09-26, including four values (3, 10, 14, 88) that each
   * appeared in several files and were nobody's decision anywhere.
   *
   * Those four are named in `space` now rather than snapped to the grid,
   * because snapping them would have redrawn every field, chip and badge
   * in the app — a visual change wearing a token change's clothes.
   *
   * ALLOWED IS DERIVED FROM `space` ITSELF, never restated: a scale this
   * test kept its own copy of would be a second opinion about the grid,
   * which is the thing the grid exists to prevent.
   */
  it("keeps every padding and margin on the scale", () => {
    const allowed = new Set<number>([0, ...Object.values(space)]);
    const offenders: string[] = [];
    let seen = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/(padding|margin)(?:Horizontal|Vertical|Top|Bottom|Left|Right|Start|End)?:\s*(\d+)/g)) {
        seen += 1;
        if (!allowed.has(Number(match[2]))) {
          offenders.push(`${file.slice(root.length + 1)}: ${match[0]}`);
        }
      }
    }
    // The size half of the rule (CLAUDE.md): a pattern that stops
    // matching passes this file in silence. Zero is a real and common
    // value, so the literals it finds are mostly `0` — what matters is
    // that it is still finding them.
    expect(seen, "the padding/margin scan matched nothing at all").toBeGreaterThan(15);
    expect(offenders, `off-scale spacing: ${offenders.join(", ")}`).toEqual([]);
  });

  /**
   * 4. LINE HEIGHTS ARE POINTS, NEVER A RATIO, and this one is a scar
   *    rather than a preference. `typography.leading` holds ratios
   *    (1.2/1.35/1.5); React Native's `lineHeight` takes POINTS. Handing
   *    it the ratio type-checks, lints clean, and draws a 1.35-point line
   *    — the glyphs are clipped to their top pixel, so the screen reads
   *    as blank rather than broken. It shipped on four styles covering
   *    five screens (every empty-state description) and NOTHING here
   *    could see it: happy-dom does no layout, so a clipped line and a
   *    drawn one are the same DOM. A phone found it.
   *
   *    The size assertion is the other half, per CLAUDE.md: a pattern
   *    that matches nothing passes every check under it, so the parse
   *    must account for every `lineHeight` the files declare.
   */
  it("gives every lineHeight points rather than a leading ratio", () => {
    const values: string[] = [];
    let declared = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      declared += (text.match(/lineHeight:/g) ?? []).length;
      for (const match of text.matchAll(/lineHeight:\s*([^,\n}]+)/g)) {
        values.push(`${file.slice(root.length + 1)}: ${match[1].trim()}`);
      }
    }

    expect(values.length, "the parse lost a lineHeight declaration").toBe(declared);
    expect(values.length, "no lineHeight found at all — the pattern is dead").toBeGreaterThan(8);

    const offenders = values.filter((entry) => {
      const value = entry.slice(entry.indexOf(": ") + 2);
      if (/\bleading\b/.test(value)) return true; // a ratio, in a points field
      if (value.startsWith("leadingFor(")) return false;
      // A literal, or an expression starting in one (`44 * stampScale`).
      // Anything under 12 points cannot be a line of readable text.
      const points = Number.parseFloat(value);
      return !Number.isFinite(points) || points < 12;
    });
    expect(
      offenders,
      `these render clipped text — use leadingFor(size): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
