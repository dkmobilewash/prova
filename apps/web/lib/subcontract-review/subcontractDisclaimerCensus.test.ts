import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SUBCONTRACT_REVIEW_DISCLAIMER } from "./disclaimer";

/**
 * "This is not legal advice…" is written ONCE and shown on every review surface.
 *
 * Two halves, both required by the feature's own rules: the sentence exists in
 * exactly one source file (so the wording cannot drift between the screen and
 * the printout), and every subcontract-review page renders `<NotLegalAdvice`.
 * Read with comments stripped, because a comment QUOTING the sentence is
 * exactly the false positive this repo has paid for twice (#185, #767).
 */

const appRoot = fileURLToPath(new URL("../../", import.meta.url));

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

describe("the not-legal-advice line", () => {
  const files = sourceFiles(appRoot);

  it("walked the app", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("is written in exactly one file", () => {
    const fragment = "not legal advice";
    // The browser specs are excluded on purpose: a spec asserts the sentence
    // LITERALLY, because a test that derived it from the constant could not
    // notice the constant changing.
    const writers = files
      .filter((file) => !file.slice(appRoot.length).startsWith("e2e/"))
      .filter((file) => stripComments(readFileSync(file, "utf8")).toLowerCase().includes(fragment));
    expect(writers.map((file) => file.slice(appRoot.length))).toEqual(["lib/subcontract-review/disclaimer.ts"]);
    expect(SUBCONTRACT_REVIEW_DISCLAIMER).toBe("This is not legal advice. Have an attorney review high-risk terms.");
  });

  it("is rendered on every subcontract-review page", () => {
    const pages = files.filter((file) => file.includes("/subcontract-review/") && file.endsWith("page.tsx"));
    expect(pages.length, "found no subcontract-review pages").toBeGreaterThan(0);
    const missing = pages.filter((file) => !stripComments(readFileSync(file, "utf8")).includes("<NotLegalAdvice"));
    expect(missing).toEqual([]);
  });
});
