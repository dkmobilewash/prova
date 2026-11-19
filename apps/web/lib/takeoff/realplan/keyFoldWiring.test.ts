import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * keyFromLabels only folds overlapping accepted walls into a UNION when its
 * second argument (feetPerUnit) is passed — its own doc says a missing
 * argument keeps the old double-counting rather than silently changing a
 * score. So the fold is a property of each CALL SITE, and this census pins
 * every eval call site to the two-argument form. Found the expensive way:
 * Round 33's restores put a wall verdict beside an older finder version's row
 * on the same geometry, and the ZT eval counted both.
 *
 * Comments are stripped before matching so prose quoting the call (like this
 * header) can never satisfy or trip the census, and the size assertion pins
 * the parsed call count to the raw occurrence count so a regex matching
 * nothing fails loudly.
 */
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("keyFromLabels call sites pass feetPerUnit", () => {
  for (const file of ["zzZeroTouch.eval.ts", "scanned.eval.ts"]) {
    it(`${file} folds overlapping accepted walls`, () => {
      const src = strip(readFileSync(join(__dirname, file), "utf8"));
      const calls = src.match(/keyFromLabels\s*\([^)]*\)/g) ?? [];
      const raw = (src.match(/keyFromLabels\s*\(/g) ?? []).length;
      expect(calls.length, "a call the paren-matcher could not parse").toBe(raw);
      const real = calls.filter((c) => !/^keyFromLabels\s*\(\s*$/.test(c));
      expect(real.length, "no call site found at all").toBeGreaterThanOrEqual(1);
      for (const call of real) {
        if (/keyFromLabels\s*\(\s*$/.test(call)) continue;
        expect(call, "a one-argument call keeps the documented double-counting").toMatch(/,\s*saved\.feetPerUnit\s*\)$/);
      }
    });
  }
});
