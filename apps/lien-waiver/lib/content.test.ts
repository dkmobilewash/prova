import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THIS TOOL NEVER SAYS A WAIVER IS SAFE TO SIGN -- the rule C-Stream's own
 * lien waiver feature lives under (apps/web/lib/lien-waiver.ts), carried
 * over whole. A census of every source file a visitor or a PDF can see,
 * for the phrases that reassure.
 *
 * Its scope is asserted, not assumed: the set of files must include the
 * copy file and the pages, so a census that silently walked nothing would
 * fail rather than pass.
 */

const ROOT = join(__dirname, "..");
const SCANNED_DIRS = ["app", "components", "lib"];
const REASSURING = [
  /safe to sign/i,
  /you(?:'|’)re all set/i,
  /looks good/i,
  /no issues/i,
  /fully compliant/i,
  /guaranteed/i,
  /legally binding/i,
  /attorney[- ]approved/i,
  /lawyer[- ]approved/i,
  /100% (?:legal|compliant|accurate)/i,
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : walk(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("no reassurance", () => {
  const files = SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir)));

  it("is looking at the files a visitor sees", () => {
    const names = files.map((file) => relative(ROOT, file));
    expect(names).toContain("lib/content.ts");
    expect(names).toContain("lib/pdf.ts");
    expect(names.some((name) => name.startsWith("app/"))).toBe(true);
    expect(names.some((name) => name.startsWith("components/"))).toBe(true);
  });

  it.each(REASSURING.map((pattern) => [pattern.source, pattern] as const))("never says /%s/", (_source, pattern) => {
    const hits = files.filter((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        // Comments quoting the rule are not copy.
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .some((line) => pattern.test(line)),
    );
    expect(hits.map((file) => relative(ROOT, file))).toEqual([]);
  });
});
