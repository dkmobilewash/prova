import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every invitation is created ON a project.
 *
 * `BidInvitation.bidProjectId` is nullable for exactly one reason: the column
 * was added without a rewrite (expand, then contract). It becomes required in a
 * later PR once nothing can write a row without it — and "nothing can" is a
 * claim, so this makes it one a build can check. The only place allowed to
 * write a bid invitation is `createInvitationOnProject`
 * (lib/estimating/bid-project.ts), which makes or joins a project in the same
 * transaction.
 *
 * Comments are stripped before matching: this repo's house style explains its
 * own history, and a comment that quotes `bidInvitation.create(` must not count
 * as a call (nor disarm the scan).
 *
 * WHAT IT CANNOT SEE: raw SQL, and the .mjs seed/cleanup scripts under
 * packages/db (seed-demo.mjs creates a project for each demo invitation by
 * hand). It scans apps/web only, and the size assertion below is derived from a
 * second, independent count rather than from the pattern.
 */

const webRoot = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "e2e") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|dbtest|eval)\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const files = ["lib", "app", "components"].flatMap((d) => sources(join(webRoot, d)));
const code = new Map(files.map((f) => [f, stripComments(readFileSync(f, "utf8"))]));

const WRITER = /\b(?:prisma|tx|db)\s*\.\s*bidInvitation\s*\.\s*(create|createMany|upsert)\s*\(/g;

describe("bid invitations are only ever written through a project", () => {
  it("scans a real number of files, counted without the pattern", () => {
    // Absence of a failure is not a pass: a walk that found nothing makes the
    // assertion below vacuously true.
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith("lib/estimating/bid-project.ts"))).toBe(true);
    // And the pattern can see a write at all: the one allowed writer is in
    // the set it scans.
    const writer = code.get(files.find((f) => f.endsWith("lib/estimating/bid-project.ts"))!)!;
    expect([...writer.matchAll(WRITER)]).toHaveLength(1);
  });

  it("has exactly one writer, and that writer sets bidProjectId", () => {
    const writers = [...code.entries()].filter(([, text]) => [...text.matchAll(WRITER)].length > 0);
    expect(writers.map(([f]) => f.slice(webRoot.length))).toEqual(["lib/estimating/bid-project.ts"]);
    const text = writers[0][1];
    const at = text.search(WRITER);
    // Only the call's own `data` argument counts: what follows `select` is the
    // return value, which mentions the same name (a mutation that dropped the
    // field from `data` survived the first version of this assertion).
    const call = text.slice(at, text.indexOf("select", at));
    expect(call).toMatch(/data:\s*\{[^}]*\bbidProjectId\s*:\s*projectId/);
  });
});
