import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * NOTHING IN THIS REPO MAY USE AN API NEWER THAN THE NODE CI RUNS.
 *
 * ── WHAT THIS COST, AND WHY A GREEN LOCAL RUN DID NOT CATCH IT ──
 *
 * #757's `reachabilityCensus.test.ts` used `fs.globSync` for the independent
 * size cross-check its own header calls for. `globSync` is **Node 22**;
 * `ci.yml` pins **Node 20**. So on a laptop running a newer Node it passed, and
 * on CI it threw `TypeError: (0 , globSync) is not a function`.
 *
 * The damage was not one red test. The Test step is first in `ci.yml`, so Lint,
 * Typecheck and Build were all SKIPPED behind it — the job reported failure
 * having checked almost nothing. #757 merged with that red, and `main` stayed
 * red until somebody else's PR inherited the failure and went looking.
 *
 * This is the shape CLAUDE.md names as the expensive one: a check that was
 * answering a different question from the one everybody thought. "It passes
 * locally" and "it passes on CI" are the same sentence only when the two run
 * the same Node, and nothing made them agree.
 *
 * ── WHAT IT ASSERTS ──
 *
 * The forbidden list is small and deliberate: these are the APIs that exist on
 * a current laptop and NOT on the Node CI pins, so each one is a trap that
 * fails exactly the way `globSync` did. It is not a general polyfill police —
 * it is the set that has bitten, plus its immediate neighbours.
 *
 * The CI version is READ OUT OF `ci.yml` rather than written here, so bumping
 * the runner relaxes this file automatically and this cannot become a rule
 * about a version nobody uses any more.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: HERE, encoding: "utf8" }).trim();

/** The APIs, the Node that introduced each, and what to use instead. */
const TOO_NEW: { pattern: RegExp; since: number; name: string; instead: string }[] = [
  {
    pattern: /\bglobSync\s*\(/g,
    since: 22,
    name: "fs.globSync",
    instead: "readdirSync(dir, { withFileTypes: true }) and your own walk — Node 10",
  },
  {
    pattern: /\bfs\.glob\s*\(/g,
    since: 22,
    name: "fs.glob",
    instead: "readdirSync(dir, { withFileTypes: true }) and your own walk — Node 10",
  },
  {
    pattern: /\bPromise\.withResolvers\s*\(/g,
    since: 22,
    name: "Promise.withResolvers",
    instead: "a `new Promise` with the resolve/reject captured — every Node",
  },
  {
    pattern: /\bObject\.groupBy\s*\(/g,
    since: 21,
    name: "Object.groupBy",
    instead: "a reduce into a Record, or a Map — every Node",
  },
  { pattern: /\bMap\.groupBy\s*\(/g, since: 21, name: "Map.groupBy", instead: "a reduce into a Map — every Node" },
];

/** Node major versions any `node-version:` in a workflow pins. */
function ciNodeVersions(): number[] {
  const dir = join(REPO, ".github/workflows");
  const files = execFileSync("git", ["ls-files", "--", ".github/workflows"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
  const found: number[] = [];
  for (const file of files) {
    const text = readFileSync(join(REPO, file), "utf8");
    for (const match of text.matchAll(/node-version:\s*["']?(\d+)/g)) found.push(Number(match[1]));
  }
  void dir;
  return found;
}

/** Every file CI's `test`, `lint`, `typecheck` or `build` could load. */
function sources(): string[] {
  return execFileSync("git", ["ls-files", "--", "apps", "packages", "scripts"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter((name) => /\.(ts|tsx|mts|mjs|js)$/.test(name) && !name.includes("/node_modules/"));
}

describe("no API newer than the Node CI runs", () => {
  const versions = ciNodeVersions();
  const files = sources();

  it("READS CI'S NODE VERSION, so this rule cannot be about a version nobody pins", () => {
    expect(versions.length, "no `node-version:` found in any workflow — this census is about nothing").toBeGreaterThan(
      0,
    );
    for (const version of versions) expect(version).toBeGreaterThanOrEqual(18);
  });

  it("READS A SOURCE SET, so a drifted file list cannot pass by finding nothing", () => {
    expect(files.length, "git listed no source files").toBeGreaterThan(500);
  });

  it("HAS SOMETHING TO FORBID, so an emptied list cannot pass as compliance", () => {
    // The third way this family of census goes quiet, after an empty source set
    // and a pattern that stops matching: the RULE itself becomes empty. A list
    // with no entry newer than CI checks nothing and reports clean. Found by
    // mutation — emptying `TOO_NEW` was the one change this file did not catch.
    const oldest = Math.min(...versions);
    expect(TOO_NEW.length, "nothing is forbidden, so this census is about nothing").toBeGreaterThan(0);
    expect(
      TOO_NEW.filter((api) => api.since > oldest).length,
      `no forbidden API is newer than the oldest CI Node (${oldest}), so every entry is skipped`,
    ).toBeGreaterThan(0);
  });

  it("USES NOTHING THE OLDEST CI NODE LACKS", () => {
    const oldest = Math.min(...versions);
    const offences: string[] = [];
    for (const file of files) {
      // This file names every forbidden API in its own list and prose, so it
      // would convict itself — the #185 shape.
      if (file.endsWith("lib/ciNodeApis.test.ts")) continue;
      let text: string;
      try {
        text = readFileSync(join(REPO, file), "utf8");
      } catch {
        continue;
      }
      // Comments are stripped first: `reachabilityCensus.test.ts` explains this
      // exact bug in prose and must not be convicted for describing it.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\n]*?\/\/[^\n]*$/gm, "");
      for (const api of TOO_NEW) {
        if (api.since <= oldest) continue;
        api.pattern.lastIndex = 0;
        if (api.pattern.test(code)) {
          offences.push(`${file}: ${api.name} is Node ${api.since}, CI runs Node ${oldest} — use ${api.instead}`);
        }
      }
    }
    expect(
      offences,
      "these pass on a newer laptop and throw on CI, where the Test step runs FIRST and takes Lint, " +
        "Typecheck and Build down with it",
    ).toEqual([]);
  });
});
