import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The guard on the guard.
 *
 * `requireApiKey()` is what stops an eval passing on nothing: without a
 * key, a run of zero cases and a run of a hundred look identical in a
 * terminal, and the first one reads as a clean bill. The failure mode of
 * that guard is not that it breaks — it is that the NEXT eval somebody
 * writes does not call it, which nothing would notice.
 *
 * So this walks the directory rather than a list. "Nothing is ever missing
 * from a directory you do not walk", and a list of eval files to check
 * would be a list somebody has to remember to add to, which is the same
 * bug one level up.
 */
const DIR = join(import.meta.dirname, ".");

describe("every eval refuses to run without a key", () => {
  const files = readdirSync(DIR).filter((name) => name.endsWith(".eval.ts"));

  it("finds the eval files at all", () => {
    // The size assertion. A pattern that matches nothing passes every
    // downstream check in the loop below, since nothing is ever missing
    // from an empty list — CLAUDE.md, the SQL guard that went green on 180
    // of 181 foreign keys.
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it("calls requireApiKey() at module scope", () => {
    for (const name of files) {
      const source = readFileSync(join(DIR, name), "utf8");
      expect(source, name).toContain("requireApiKey()");
      // At module scope, not inside a test: a check that runs inside the
      // first `it` has already let the suite start, and a suite that
      // starts and throws once is a suite with one failure rather than a
      // suite that did not run.
      expect(source, name).toMatch(/^requireApiKey\(\);$/m);
    }
  });
});
