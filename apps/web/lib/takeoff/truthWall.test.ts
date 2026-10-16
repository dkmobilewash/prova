import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ── THE ANSWERS ARE WALLED OFF FROM THE DETECTOR ──
 *
 * `fixtures/truth/` holds the generator's own geometry for the twenty sheets —
 * every wall's centreline, its gross and net length, the exterior/interior
 * split. It is the only wall-footage ground truth this set has, and it is only
 * ground truth for as long as nothing under test can see it.
 *
 * A detector that reads the key stops being evidence of anything, and it would
 * not look like cheating in a diff: one import, in a file that already has
 * twenty, and every number afterwards is perfect.
 *
 * So: only a SCORER may read `truth/`. Anything else under `lib/takeoff` that
 * imports it fails the build here.
 *
 * This is the same promise `expected.test.ts` makes about the text-derived
 * keys, from the other side — that one says a key must never claim a wall
 * length, this one says the engine must never read one.
 */
const TAKEOFF = join(import.meta.dirname);

/** Files allowed to read the answers: the scorers, and this guard. */
const SCORERS = new Set([
  "fixtures/truthScore.eval.ts",
  "truthWall.test.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // The keys and the generator are DATA, not code under test.
    if (entry === "truth" || entry === "generator" || entry === "plans" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("the answer keys are walled off from the engine", () => {
  const files = walk(TAKEOFF);

  it("READS A REAL SET OF FILES, so a silent zero is not a pass", () => {
    // The whole guard is a search for something that should not be there, and
    // a search over nothing finds nothing. CLAUDE.md's own rule: assert the
    // SIZE of a derived set against a source that cannot drift with it.
    expect(files.length, "no TypeScript was found under lib/takeoff").toBeGreaterThan(40);
    expect(
      files.some((f) => f.endsWith("findWallsOnSheet.ts")),
      "the walk missed the engine's own entry point, so it proves nothing",
    ).toBe(true);
  });

  it("NOTHING BUT A SCORER IMPORTS `truth/`", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(TAKEOFF.length + 1);
      if (SCORERS.has(rel)) continue;
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      // Any path that reaches the keys, however it is spelled.
      if (/["'`][^"'`]*fixtures\/truth[^"'`]*["'`]/.test(code)) offenders.push(rel);
    }
    expect(
      offenders,
      `these read the answer keys and are not scorers: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the scorer it DOES allow actually exists, so the exemption is not stale", () => {
    for (const scorer of SCORERS) {
      expect(
        files.some((f) => f.endsWith(scorer.split("/").pop() ?? "")),
        `${scorer} is exempted but no such file exists — remove the exemption`,
      ).toBe(true);
    }
  });
});
