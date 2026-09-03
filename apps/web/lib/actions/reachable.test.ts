import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every Server Action must be reachable from something.
 *
 * This exists because of a bug class that has now shipped three times in one
 * day, twice in Diego's lane and once in mine: an action that is written
 * correctly, exported, re-exported through the barrel, and called from
 * NOWHERE. `sendOutboundEmail` was defined, exported, and had no form
 * anywhere in the app — so `/messages` was a delivery log with no way to
 * create an entry, and the page rendered its empty state perfectly forever.
 *
 * Nothing in the existing toolchain can catch this:
 *
 * - **typecheck** passes, because the code is correct. It just isn't used.
 * - **lint** passes, because the symbol IS exported and consumed — by the
 *   barrel.
 * - **build** passes for the same reason.
 * - **clicking passes**, and this is the part worth sitting with. A feature
 *   with no entry point renders as a working empty state. "I clicked
 *   through it" is evidence of nothing when the button was never built.
 *
 * The barrel is what makes this invisible: `export * from "./messages"`
 * looks like a use and is the opposite of one — it is precisely the thing
 * that lets an orphan compile. So the barrel and the action's own module
 * are both excluded from counting as a caller here.
 *
 * A failure means one of two things, and both are worth stopping for: the
 * feature has no entry point, or the action is dead and should be deleted.
 *
 * Two limits, both raised by Diego reviewing this and both deliberate:
 *
 * - It matches `export async function name(` only. An action written as
 *   `export const name = async (...)` is INVISIBLE to this check and would
 *   silently opt itself out. Every action in lib/actions/ uses the function
 *   form today, which is what makes this accurate — if you are about to
 *   write the arrow form, either don't, or widen the pattern below first.
 * - Finding the name is a substring match, so a comment mentioning an
 *   action counts as a caller. That errs towards passing, which is the
 *   right way for it to be wrong: a check that fails on something real is
 *   worth far more than one that is precise about dead code.
 */

const ACTIONS_DIR = resolve(__dirname);
const WEB_ROOT = resolve(__dirname, "../..");

/** Files that may define an action but can never count as its caller. */
const NOT_A_CALLER = new Set(["index.ts", "shared.ts"]);

/**
 * True for any TEST file, unit or database.
 *
 * Written as one predicate because the obvious spelling of it is wrong in
 * a way that is invisible: `.dbtest.ts` does NOT match `/\.test\.tsx?$/`,
 * because the character before `test.ts` is `b`, not a dot. The same
 * near-miss defeats `name.endsWith(".test.ts")`.
 *
 * That let all 15 `.dbtest.ts` files count as CALLERS, so an action whose
 * only reference was its own database test read as reachable. Exactly one
 * action was hiding behind it — `updateApprenticeshipEnrollment`, the
 * only write path for `completedOn`/`cancelledOn`, with no UI at all, so
 * every apprenticeship on /union-compliance was permanently ACTIVE. See
 * issues #119 and #120.
 *
 * A guard that cannot see an omission is not a guard; this file has been
 * that twice now, counting the ROUTE_CAPABILITY version in #87.
 */
function isTestFile(name: string): boolean {
  return /\.(?:db)?test\.tsx?$/.test(name);
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry) && !isTestFile(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/** `export async function name(` — the shape every Server Action in this
 * codebase uses. */
function exportedActions(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/^export async function ([A-Za-z0-9_]+)\s*\(/gm)].map((m) => m[1]);
}

const actionModules = readdirSync(ACTIONS_DIR)
  .filter((f) => f.endsWith(".ts") && !isTestFile(f) && !NOT_A_CALLER.has(f))
  .map((f) => join(ACTIONS_DIR, f));

const allSources = sourceFiles(join(WEB_ROOT, "app"))
  .concat(sourceFiles(join(WEB_ROOT, "components")))
  .concat(sourceFiles(join(WEB_ROOT, "lib")));

describe("every Server Action is reachable", () => {
  const actions = actionModules.flatMap((file) =>
    exportedActions(file).map((name) => ({ name, file })),
  );

  it("finds the action modules at all", () => {
    // Guards the guard: if the glob or the regex ever stops matching, this
    // whole file would pass by finding nothing to check — the most
    // dangerous way for a test like this to fail.
    expect(actions.length).toBeGreaterThan(30);
  });

  it.each(actions)("$name is called from somewhere", ({ name, file }) => {
    const callers = allSources.filter((source) => {
      if (source === file) return false; // its own definition
      const base = source.split("/").pop() ?? "";
      if (source.startsWith(ACTIONS_DIR) && NOT_A_CALLER.has(base)) return false; // the barrel
      return new RegExp(`\\b${name}\\b`).test(readFileSync(source, "utf8"));
    });

    expect(
      callers.length,
      `${name} (${file.replace(WEB_ROOT, "")}) is exported but nothing calls it.\n` +
        `Either the feature has no entry point — no form, no button — or the action is ` +
        `dead and should be deleted. A barrel re-export does not count: it is what lets ` +
        `an orphan compile.`,
    ).toBeGreaterThan(0);
  });
});
