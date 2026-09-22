import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `instanceof Prisma.PrismaClientKnownRequestError` is a guard that is
 * FALSE at runtime in this app, and this file is the fourth time we have
 * paid for it.
 *
 * Under Next's bundling the error Prisma throws and the class on the
 * re-exported `Prisma` namespace are different copies, so the guard never
 * fires: the branch you wrote for the user is skipped and the raw error
 * escapes as a 500. #25 (`company.ts`), #26 (`assignCrewMember`) and
 * `lib/auth.ts`'s concurrent-first-sign-in recovery were each found
 * separately, by hand, after each had shipped. The phone's punch-list
 * replay guard was the fourth — found in review rather than by anything
 * that runs, which is what this file changes.
 *
 * `isUniqueConstraintError` in lib/actions/shared.ts is the replacement,
 * and it checks what actually arrives: `.code`.
 */

const WEB = join(__dirname, "..");
const SKIP = new Set(["node_modules", ".next", ".turbo", "dist"]);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if ((full.endsWith(".ts") || full.endsWith(".tsx")) && !full.includes(".test.")) out.push(full);
  }
  return out;
}

describe("the Prisma error guard that is false at runtime", () => {
  it("appears nowhere outside a comment explaining why not", () => {
    const files = sources(WEB);
    // A parser has two failure modes and only one of them looks like a
    // failure (see CLAUDE.md). An empty walk would pass this file
    // silently, so the size is asserted against something that cannot
    // drift with the pattern below.
    expect(files.length, "the source walk came back empty or near-empty").toBeGreaterThan(300);

    const offenders: string[] = [];
    for (const file of files) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const code = line.trimStart();
        if (code.startsWith("*") || code.startsWith("//")) continue;
        if (code.includes("instanceof Prisma.PrismaClientKnownRequestError")) {
          offenders.push(file.slice(WEB.length + 1));
        }
      }
    }

    expect(
      offenders,
      `these guard on an instanceof that is false at runtime — use isUniqueConstraintError: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
