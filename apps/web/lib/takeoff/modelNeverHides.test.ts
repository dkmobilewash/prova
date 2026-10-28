/**
 * THE CLASSIFIER NEVER HIDES A LINE. IT ONLY GREYS ONE.
 *
 * Diego's decision, 2026-10-28, from a measurement: at NO cut does this
 * classifier recover 3 ft of real wall per 1 ft of junk by REMOVING lines, so
 * it is not used to remove them. It is used in demote mode, where a doubted
 * run stays on the drawing, greyed, with its reason, out of the total and one
 * click from coming back.
 *
 * The asymmetry is the whole argument. A wrong demote costs a click. The same
 * judgement applied as a veto costs a wall, silently, on a bid.
 *
 * The plumbing for a veto still exists in `findWallsOnSheet`, because the
 * BENCH needs it to measure what a veto would have done — that is how we know
 * no cut qualifies. This file is what keeps that plumbing out of the product:
 * a `veto:` supplied from app code would reinstate the hiding nobody chose.
 *
 * SCOPE IS DERIVED, NOT LISTED, for the reason `theme-contrast.test.ts`
 * records: nothing is ever missing from a directory you do not walk.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = new URL("../..", import.meta.url).pathname;

/** Everything the app ships, excluding tests, evals and the bench. */
function appFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "bench" || entry === "e2e" || entry === "realplan") continue;
      appFiles(path, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry) || /\.eval\.ts$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

const ROOTS = ["lib", "components", "app"].map((d) => join(WEB, d));
const FILES = ROOTS.flatMap((r) => appFiles(r));
/** Comments are stripped: this repo documents its scars, and those sentences
 *  name the very thing the assertion forbids. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the classifier never hides a line in the product", () => {
  it("walked a real set of app files, so the check is about something", () => {
    expect(FILES.length, "no app files were scanned").toBeGreaterThan(200);
    expect(FILES.some((f) => f.endsWith("findWallsOnSheet.ts"))).toBe(true);
    expect(FILES.some((f) => f.endsWith("TakeoffPlanViewer.tsx"))).toBe(true);
  });

  it("no app file SUPPLIES a veto to the finder", () => {
    // `veto?:` declarations and `veto: input.veto` pass-throughs are the
    // plumbing the bench uses. What must not appear is app code handing the
    // finder a predicate of its own.
    const offenders: string[] = [];
    for (const file of FILES) {
      const code = strip(readFileSync(file, "utf8"));
      for (const m of code.matchAll(/\bveto:\s*(?!input\.veto\b|undefined\b|null\b|hooks\.veto\b)(\S[^,\n]*)/g)) {
        offenders.push(`${file.replace(WEB, "")}: veto: ${m[1].slice(0, 40)}`);
      }
    }
    expect(offenders, `the classifier is being used to REMOVE lines:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the viewer holds the model only in demote mode", () => {
    const code = strip(readFileSync(join(WEB, "components/TakeoffPlanViewer.tsx"), "utf8"));
    expect(code, "the model is no longer gated on the demote switch").toMatch(
      /wallModelRef\.current\s*=\s*demote\s*\?\s*wallModel\s*:\s*null/,
    );
  });

  it("the default cut is the one that was decided", () => {
    const code = readFileSync(join(WEB, "lib/takeoff/wallModelFile.ts"), "utf8");
    expect(code).toMatch(/DEFAULT_WALL_MODEL_CUT\s*=\s*0\.2\b/);
  });
});
