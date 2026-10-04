import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NO SERVER-SIDE WORK IS LEFT ON A FLOATING PROMISE.
 *
 * `void someAsync()` in a server action does not mean "later". It means
 * "until the response is sent" — Vercel may tear the function down the
 * moment the action returns, and whatever the promise had left to do dies
 * with it, silently. `after()` from `next/server` is the same intent
 * (respond now, work continues) with the function kept alive until the
 * work finishes.
 *
 * FOUND 2026-09-27, AND THE WAY IT WAS FOUND IS THE POINT. The alert
 * digest's push half had NEVER arrived while its email half always had.
 * Nothing was logged, because nothing was alive to log it — the defect was
 * invisible from the server's own output and could only be noticed by a
 * person missing a banner on a phone.
 *
 * What named it was the CONTROL, not the suspect: `assignCrewMember` is
 * also fire-and-forget and its push DOES arrive, because it is one HTTP
 * call with a millisecond-wide window, where `dispatchAlertPush` makes
 * five database round-trips first. Two pushes to the same phone 49 minutes
 * apart, one landing and one not, is what ruled out the token, the key,
 * the permission and the transport all at once.
 *
 * Both are `after()` now — including the one that was working, because it
 * was working on ODDS, and odds are not a design.
 *
 * WHAT THIS CANNOT SEE, said plainly: it matches the `void` spelling. A
 * promise dropped some other way — assigned to an unused variable, or
 * returned from a non-awaited helper — is invisible to it, and no test
 * here can see a serverless teardown at all. It stops the spelling that
 * shipped this bug from being typed again, which is a smaller claim than
 * "floating promises are impossible" and is the honest one.
 */

const WEB = join(__dirname, "..");
const ROOTS = [join(WEB, "lib"), join(WEB, "app")];

/**
 * `void` that is CORRECT, with the reason. Each entry is a decision;
 * anything not here is a bug. The distinction is whether the work is meant
 * to SURVIVE the response or to STOP — `after()` is wrong for the latter.
 */
const DELIBERATE: Record<string, string> = {
  "app/api/ask/route.ts":
    "a stream cancel() handler ending an abandoned generator — it is stopping work, not asking for it to outlive the response, and after() would be the opposite of what it means",
};

/** Files that must still contain an `after(` call. Without this the census
 * passes just as happily on a codebase that deleted both fixes, because a
 * pattern that matches nothing is never violated. */
const FIXED = ["lib/actions/notifications.ts", "lib/actions/jobs.ts"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full) && !full.includes(".test.")) out.push(full);
  }
  return out;
}

/**
 * Comments stripped, and that is load-bearing rather than tidy: the note
 * explaining this bug in `actions/notifications.ts` QUOTES `void
 * dispatchAlertPush(...)` verbatim. A raw-text census would flag the file
 * that carries the fix, somebody would quiet it by adding a DELIBERATE
 * entry, and that entry would then hide the real thing. Same shape as
 * #185, where a comment quoting a census's own pattern disarmed it.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function sources(): { path: string; text: string }[] {
  return ROOTS.flatMap(walk).map((path) => ({
    path: relative(WEB, path),
    text: stripComments(readFileSync(path, "utf8")),
  }));
}

describe("background work in server code", () => {
  it("scans a set that contains the files the bug was in", () => {
    // Size AND scope, because a walk that reaches neither offender would
    // pass every assertion below it. Both fixed files are nested two deep.
    const found = sources().map((s) => s.path);
    expect(found.length, "the walk returned nothing — the roots moved").toBeGreaterThan(50);
    for (const f of [...FIXED, ...Object.keys(DELIBERATE)]) {
      expect(found, `${f} was not scanned, so nothing below this can see it`).toContain(f);
    }
  });

  it("leaves no work on a floating promise", () => {
    const offenders = sources()
      .filter((s) => !(s.path in DELIBERATE))
      .filter((s) => /^\s*void\s+[a-zA-Z_$][\w$.]*\s*\(/m.test(s.text))
      .map((s) => s.path);
    expect(
      offenders,
      `These drop a promise on the floor: ${offenders.join(", ")}. In a server action that ` +
        `means the work is killed when the response is sent — silently, with nothing logged, ` +
        `which is how the alert push went missing for two days. Use after() from "next/server", ` +
        `or add an entry to DELIBERATE saying why stopping is what you meant.`,
    ).toEqual([]);
  });

  it("still has the two fixes, so the assertion above is not vacuous", () => {
    for (const path of FIXED) {
      const text = stripComments(readFileSync(join(WEB, path), "utf8"));
      expect(text, `${path} no longer imports after() from next/server`).toMatch(
        /import\s*\{[^}]*\bafter\b[^}]*\}\s*from\s*"next\/server"/,
      );
      expect(text, `${path} no longer calls after(`).toMatch(/\bafter\(/);
    }
  });

  it("keeps every DELIBERATE entry real, and explained", () => {
    // An exemption list nobody prunes becomes a list of bugs. A path that
    // has stopped using `void` must leave, or the next one inherits cover
    // it did not earn.
    for (const [path, reason] of Object.entries(DELIBERATE)) {
      const text = stripComments(readFileSync(join(WEB, path), "utf8"));
      expect(text, `${path} is exempted but no longer uses void — drop the entry`).toMatch(
        /^\s*void\s+[a-zA-Z_$][\w$.]*\s*\(/m,
      );
      expect(reason.length, `${path}'s exemption needs a real reason`).toBeGreaterThan(30);
    }
  });
});
