import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every opener a spec presses through `openCollapsed`, every row group it
 * opens through `details[name="…"]`, and every one-off disclosure it opens
 * through `details#…`, must still exist in the app.
 *
 * A renamed opener does not fail a Playwright run with "no such button" — it
 * fails as a 15-second `toPass` timeout on a CI runner, after a cold build,
 * which is the exact silence #774 was (a fill waiting forever on a form a
 * CollapsedForm had not rendered). This answers the same question in a
 * second, from source: the label a spec presses is a `label="…"` the app
 * passes, or a button's own text line; the row name it opens is a `name="…"`
 * the app renders. Read as text, like jobTabs.test.ts reads journey.ts,
 * because these files load @playwright/test.
 *
 * Both sets are DERIVED by regex, so each is also counted independently of
 * its pattern (CLAUDE.md, "a check that derives its input has two failure
 * modes"): a call this parse skips fails here as a count mismatch instead of
 * quietly shrinking the set.
 */
const e2eRoot = path.join(__dirname, "..");
const webRoot = path.join(e2eRoot, "..");

function walk(dir: string, keep: (file: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === ".next" ? [] : walk(full, keep);
    return keep(full) ? [full] : [];
  });
}

const callers = [...walk(path.join(e2eRoot, "specs"), (f) => f.endsWith(".ts")), path.join(__dirname, "journey.ts")].map(
  (file) => readFileSync(file, "utf8"),
);
const appSource = ["app", "components"]
  .flatMap((dir) => walk(path.join(webRoot, dir), (f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f)))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const appLines = new Set(appSource.split("\n").map((line) => line.trim()));

const openerCalls = callers.flatMap((source) => [...source.matchAll(/\bopenCollapsed\(\s*[^,]+,\s*"([^"]+)"/g)].map((m) => m[1]));
const openerCallCount = callers.reduce((n, source) => n + (source.match(/\bopenCollapsed\(/g) ?? []).length, 0);

const rowNames = callers.flatMap((source) => [...source.matchAll(/details\[name="([^"]+)"\]/g)].map((m) => m[1]));
const rowNameCount = callers.reduce((n, source) => n + (source.match(/details\[name=/g) ?? []).length, 0);

// A one-off disclosure addressed by its id (`details#templates`, /catalog's
// "Estimate templates · N", declutter round 3).
const disclosureIds = callers.flatMap((source) => [...source.matchAll(/details#([\w-]+)/g)].map((m) => m[1]));
const disclosureIdCount = callers.reduce((n, source) => n + (source.match(/details#/g) ?? []).length, 0);

describe("what the e2e specs open still exists in the app", () => {
  it("parses every openCollapsed call and every row-name selector the specs make", () => {
    expect(openerCalls.length, "no openCollapsed call parsed — every check below would be vacuous").toBeGreaterThan(0);
    expect(openerCalls.length, "an openCollapsed call this parse skipped").toBe(openerCallCount);
    expect(rowNames.length, "no details[name] selector parsed").toBeGreaterThan(0);
    expect(rowNames.length, "a details[name] selector this parse skipped").toBe(rowNameCount);
    expect(disclosureIds.length, "no details#id selector parsed").toBeGreaterThan(0);
    expect(disclosureIds.length, "a details#id selector this parse skipped").toBe(disclosureIdCount);
  });

  it.each([...new Set(openerCalls)])('the opener "%s" is a CollapsedForm label or a button text in the app', (label) => {
    expect(appSource.includes(`label="${label}"`) || appLines.has(label)).toBe(true);
  });

  it.each([...new Set(rowNames)])('the row group "%s" is a Disclosure name the app renders', (name) => {
    expect(appSource.includes(`name="${name}"`)).toBe(true);
  });

  it.each([...new Set(disclosureIds)])('the disclosure id "%s" is an id the app renders', (id) => {
    expect(appSource.includes(`id="${id}"`)).toBe(true);
  });
});
