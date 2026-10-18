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

/**
 * Files allowed to mention a held-out plan at all.
 *
 * `zzHeldout.eval.ts` opens the DRAWING it is told to measure and has no way
 * to reach a key; this guard names the things it is guarding against.
 */
const HELDOUT_READERS = new Set(["realplan/zzHeldout.eval.ts", "truthWall.test.ts"]);

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

  /**
   * ── AND THE HELD-OUT PLANS, WHICH ARE NOT IN THE REPOSITORY AT ALL ──
   *
   * `fixtures/truth/` is the twenty fixtures' key and it is committed, so the
   * rule above can be a path test. A held-out plan is different in kind: its
   * drawing and its key live outside the tree — Cedar Hollow is the first —
   * and the engine must never reach them wherever they are.
   *
   * Three ways it could, and all three are refused:
   *
   *   - naming the file, which is how somebody "just checks one number";
   *   - reading the environment variable a scorer is given it through;
   *   - reaching into the folder the drawings sit in.
   *
   * The eval that RUNS a held-out plan is allowed to name its own input
   * variable, because that is the plan rather than the answer — it is in
   * `SCORERS` for that reason, and it has no way to find a key.
   */
  it("NOTHING READS A HELD-OUT ANSWER KEY, which is not in the tree to be found", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(TAKEOFF.length + 1);
      if (HELDOUT_READERS.has(rel)) continue;
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      // NARROW ON PURPOSE. The first version matched `ANSWER KEY` anywhere
      // and caught the answer-key REVIEW feature — a product that helps a
      // person build their own key, which has nothing to do with a held-out
      // plan. A guard that fires on the wrong thing gets exemptions added
      // until it fires on nothing.
      //
      // What identifies a held-out key: the file, the folder it lives in, or
      // an environment variable pointing at one.
      if (/cedar-hollow|HELDOUT_KEY|takeoff\/heldout|ANSWER-KEY\.pdf/i.test(code)) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      `these reach for a held-out answer key: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the held-out reader it allows is the eval, and it reads a PLAN not a key", () => {
    // Anti-vacuity, and the distinction the exemption rests on: the eval may
    // open the drawing it is told to measure. It must have no way to open the
    // answers.
    const runner = files.find((f) => f.endsWith("zzHeldout.eval.ts"));
    expect(runner, "the held-out eval is exempted but does not exist").toBeTruthy();
    const code = readFileSync(runner as string, "utf8");
    expect(code, "the held-out eval does not read a plan at all").toContain("HELDOUT_PDF");
    expect(
      /HELDOUT_KEY|ANSWER-KEY\.pdf|cedar-hollow/i.test(
        code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
      ),
      "the held-out eval reaches for the answer key",
    ).toBe(false);
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
