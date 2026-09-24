import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * NOTHING UNDER `apps/web/lib` MAY CONSTRUCT A PRISMA VALUE AT MODULE SCOPE.
 *
 * `lib/change-order.ts` held `const ZERO = new Prisma.Decimal(0)` at the top
 * level, and that single line made the module impossible to import without a
 * live Prisma client. 148 test files in `apps/web` mock `@prova/db`, and 53 of
 * them stub `Prisma` as an object — so every page whose import graph reached
 * `change-order.ts` threw "Prisma.Decimal is not a constructor" at IMPORT
 * time, before a single test in the file ran.
 *
 * WHAT MAKES IT WORTH A CENSUS RATHER THAN A FIX. Three separate branches hit
 * it, and all three patched their own `vi.mock` factory to carry a Decimal
 * constructor. Each patch worked, each looked local and reasonable, and none
 * of their authors looked at the cause — so the repo was three copies of a
 * workaround deep before anybody asked why the workaround was needed. That is
 * the shape this file exists to stop: not a bug that fails loudly, but one
 * whose workaround is cheap enough that nobody investigates.
 *
 * The rule is narrow on purpose. Constructing inside a function is fine — the
 * client exists by the time anything calls it. Only the module-scope `new` is
 * refused, because that is the one that runs on import.
 *
 * MUTATION-TESTED: restoring the original line to `change-order.ts` turns this
 * red and names the file and line.
 */

const appDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Git's list, not a hand-rolled walk — a directory this file does not walk
 * can never be missing anything, which is the scope scar CLAUDE.md records
 * from `theme-contrast.test.ts`. */
function libSources(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "lib"], {
    cwd: appDir,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\n")
    .filter((p) => p.endsWith(".ts") && !p.endsWith(".d.ts"));
}

/** Comments stripped, so a paragraph QUOTING the banned line — like the one in
 * `change-order.ts` explaining why it was removed — cannot trip this. That is
 * the #185 scar: a census a comment could disarm. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** A `new Prisma.Something(...)` on a line that starts at column zero — i.e.
 * not indented inside a function body. Deliberately simple: the offending
 * shape is always a top-level `const`, and a cleverer parse would be a second
 * thing to get wrong. */
const MODULE_SCOPE_NEW = /^(?:export\s+)?(?:const|let|var)\s+\w+[^\n]*=\s*new\s+Prisma\./;

describe("no Prisma value is constructed when a module is imported", () => {
  it("finds the library, so an empty sweep cannot pass by accident", () => {
    const files = libSources();
    expect(files.length, "git listed almost nothing — is this a checkout?").toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("change-order.ts"))).toBe(true);
  });

  it("has a pattern that matches the thing it is looking for", () => {
    // Anti-vacuity: the regex must still recognise the original defect.
    expect(MODULE_SCOPE_NEW.test("const ZERO = new Prisma.Decimal(0);")).toBe(true);
    expect(MODULE_SCOPE_NEW.test("export const Z = new Prisma.Decimal(0);")).toBe(true);
    // ...and must NOT flag the legitimate shape.
    expect(MODULE_SCOPE_NEW.test("  return new Prisma.Decimal(0);")).toBe(false);
    expect(MODULE_SCOPE_NEW.test("const zero = () => new Prisma.Decimal(0);")).toBe(false);
  });

  it("constructs no Prisma value at module scope", () => {
    const offenders: string[] = [];
    for (const relative of libSources()) {
      const source = withoutComments(readFileSync(join(appDir, relative), "utf8"));
      source.split("\n").forEach((line, index) => {
        if (MODULE_SCOPE_NEW.test(line)) offenders.push(`${relative}:${index + 1}  ${line.trim()}`);
      });
    }
    expect(
      offenders,
      "A module-scope `new Prisma.X()` runs on IMPORT, so every test that stubs " +
        "`Prisma` breaks before it starts — and the workaround (a Decimal in the mock " +
        "factory) is cheap enough that nobody investigates. Build it inside a function " +
        "instead: `const zero = () => new Prisma.Decimal(0)`.",
    ).toEqual([]);
  });
});
