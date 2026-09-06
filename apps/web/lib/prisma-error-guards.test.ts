import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isUniqueConstraintError } from "./actions/shared";

/**
 * No catch block may decide a Prisma error's meaning by `instanceof`.
 *
 * `error instanceof Prisma.PrismaClientKnownRequestError` is FALSE at
 * runtime in this app. The generated client's internal error class and the
 * `Prisma` namespace re-exported through `@prova/db` are different copies
 * under Next's bundling (`next.config.mjs` has `@prova/db` in
 * `transpilePackages`, and that package does `export * from
 * "@prisma/client"`). Measured in the running app on 2026-08-28:
 *
 *     DIAG ctor:       PrismaClientKnownRequestError
 *     DIAG code:       P2002
 *     DIAG instanceof: false
 *
 * Three guards were written against that class and none of them ever fired:
 *
 *   - `company.ts` inviteTeamMember (#25) — the friendly "already invited"
 *     sentence was unreachable, and a duplicate invite escaped raw.
 *   - `jobs.ts` assignCrewMember (#26) — the P2002 it meant to swallow was
 *     always rethrown, so re-assigning an already-assigned teammate 500'd.
 *     Note the LOGIC there was correct (`if (!(known && P2002)) throw`);
 *     only the class test was wrong.
 *   - `auth.ts` requireCompanyContext — found while fixing those two and in
 *     neither issue. Its whole concurrent-first-sign-in recovery was dead.
 *
 * THIS TEST CANNOT BE WRITTEN AS AN EXECUTION TEST, AND THAT IS THE POINT
 * WORTH READING. Under Vitest the instanceof is TRUE — Node resolves
 * `@prisma/client` once, so there is only one copy of the class and the
 * broken code behaves perfectly. Measured on this machine against a real
 * scratch Postgres on 2026-09-05, triggering a genuine duplicate insert:
 * ctor `PrismaClientKnownRequestError`, code `P2002`, `instanceof` **true**.
 * A test that triggers a real P2002 and asserts the friendly sentence comes
 * back therefore passes with the bug fully present. It would be one more
 * green test that cannot fail — this repo filed #150 about four of those —
 * so the divergence is checked where it is actually visible: the source.
 *
 * The execution half that IS worth having lives in
 * `lib/actions/unique-constraint-guards.dbtest.ts`, which pins
 * `isUniqueConstraintError` against an error real Prisma really threw.
 */

const WEB = resolve(__dirname, "..");
const SEARCH_ROOTS = ["lib", "app", "components"];

function tsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const FILES = SEARCH_ROOTS.flatMap((r) => tsFiles(join(WEB, r)));

it("finds the files it is supposed to be checking", () => {
  expect(FILES.length).toBeGreaterThan(200);
});

describe("Prisma errors are recognised by code, never by class", () => {
  it("nothing tests a Prisma error with instanceof", () => {
    const offenders: string[] = [];

    for (const file of FILES) {
      // Its own docstring quotes the banned form to explain it, and so does
      // this file. Neither is a guard.
      if (file.endsWith("prisma-error-guards.test.ts")) continue;

      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        if (line.trim().startsWith("*") || line.trim().startsWith("//")) return;
        if (/instanceof\s+Prisma\.\w*Error/.test(line)) {
          offenders.push(`${file.slice(WEB.length + 1)}:${i + 1}`);
        }
      });
    }

    expect(
      offenders,
      "`instanceof Prisma.<SomeError>` is false at runtime under Next's " +
        "bundling, so a guard written this way never fires and the error it " +
        "meant to translate escapes to the user as a 500. Use " +
        "`isUniqueConstraintError(err)` from lib/actions/shared.ts, or test " +
        "the `code` property directly.",
    ).toEqual([]);
  });

  /** The mock in `auth.test.ts` supplies its own
   * `PrismaClientKnownRequestError` class, which makes the instanceof TRUE
   * inside that suite. That is the shape of a test that cannot fail, and it
   * is worth naming: if a guard like that comes back, its test will be
   * green about it. */
  it("does not let a test's own Prisma stub stand in for the real class", () => {
    const authTest = readFileSync(join(WEB, "lib/auth.test.ts"), "utf8");
    const stubsTheClass = /PrismaClientKnownRequestError/.test(authTest);
    const authSource = readFileSync(join(WEB, "lib/auth.ts"), "utf8");
    const usesTheClass = /instanceof\s+Prisma\.PrismaClientKnownRequestError/.test(authSource);

    expect(
      stubsTheClass && usesTheClass,
      "auth.test.ts mocks @prova/db with its own " +
        "PrismaClientKnownRequestError class. If auth.ts guards on " +
        "`instanceof` that class, the test sees ONE copy and passes while " +
        "production sees two and fails. Guard on the code instead.",
    ).toBe(false);
  });
});

describe("isUniqueConstraintError", () => {
  it("recognises a P2002 whatever class it belongs to", () => {
    class SomeOtherCopy extends Error {
      code = "P2002";
    }
    expect(isUniqueConstraintError(new SomeOtherCopy())).toBe(true);
    expect(isUniqueConstraintError({ code: "P2002" })).toBe(true);
  });

  it("does not swallow other Prisma failures", () => {
    // P2025 is "record not found" — the one that turned a recoverable race
    // in auth.ts into a 500 once already. Swallowing it here would hide it
    // again.
    expect(isUniqueConstraintError({ code: "P2025" })).toBe(false);
    expect(isUniqueConstraintError(new Error("connection lost"))).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
    expect(isUniqueConstraintError(undefined)).toBe(false);
    expect(isUniqueConstraintError("P2002")).toBe(false);
  });
});
