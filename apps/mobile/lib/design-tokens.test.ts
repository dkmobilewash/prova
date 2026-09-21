import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
});
