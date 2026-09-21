import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cacheKeys } from "./cache-keys";
import { PREFETCHED_KEYS } from "./prefetch";

/**
 * The prefetch and the screens must agree about where a job's sections
 * live, and every screen that reads a list must read it through the cache.
 *
 * Both halves are invisible failures. A prefetch writing a key no screen
 * reads is wasted bandwidth on somebody's cellular plan and looks
 * perfect in review. A screen reading a key the prefetch never writes is
 * a blank page in a basement — which is the bug this whole change exists
 * to fix, found on site rather than by anything that runs.
 */

const ROOT = join(__dirname, "..");
const APP = join(ROOT, "app");
const LIB = join(__dirname);

/** A path as this file talks about it: "app/outbox.tsx", "lib/use-sync.ts".
 * One spelling, so an exception key and an offender message cannot drift
 * apart — they did, and an exception silently matched nothing. */
function rel(file: string): string {
  return file.slice(ROOT.length + 1);
}

/** Every source file under `dir`, screens AND the hooks they call.
 *
 * This used to collect `.tsx` only, which was invisibly wrong the moment
 * it was pointed at `lib/`: the token rule below was run over a list that
 * could not contain `use-sync.ts` or `use-field-reports.ts`, and passed
 * because an empty question has no wrong answers. Same shape as the SQL
 * census in CLAUDE.md — a parser's two failure modes are a wrong answer
 * and no question at all, and only the first one looks like a failure.
 * `sources()` below asserts the size against a count that cannot drift
 * with this filter. */
function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (full.endsWith(".tsx") || (full.endsWith(".ts") && !full.endsWith(".test.ts"))) out.push(full);
  }
  return out;
}

/** The screens, and the hooks under lib/ that load on their behalf. */
function sources(): string[] {
  const all = [...files(APP), ...files(LIB)];
  // A floor, not a total: it fails loudly if the walk ever comes back
  // empty or collapses to one extension, and does not need editing every
  // time a screen is added.
  if (all.filter((f) => f.endsWith(".tsx")).length < 10) throw new Error("the screen walk found almost nothing");
  if (all.filter((f) => f.endsWith(".ts")).length < 10) throw new Error("the lib walk found almost nothing");
  return all;
}

/** Screens that legitimately call the API without caching, each with its
 * reason. A screen added to this list is a decision; a screen missing
 * from it is a bug. */
/** Files that flush the queue and do NOT owe a cached list to a screen —
 * the two places where flushing is the job rather than something a list is
 * waiting behind. Each is checked below for still being that. */
const FLUSH_WITHOUT_LIST: Record<string, string> = {
  "app/outbox.tsx": "the screen about the queue itself: it reads the QUEUE, not a cached list, and reloads after Send now",
  "lib/use-queue-drain.ts": "the background timer; flushing is its whole purpose and it draws nothing",
};

/** Screens that legitimately call the API without caching, each with its
 * reason. A screen added to this list is a decision; a screen missing
 * from it is a bug. */
const NOT_CACHED: Record<string, string> = {
  "(tabs)/camera.tsx": "a doorway to the photo screen; it loads nothing itself",
  "(tabs)/create.tsx": "a launcher; the screens it opens do the loading",
  "(tabs)/settings.tsx": "the signed-in account, which Clerk holds on the device",
};

describe("the cache the phone actually uses", () => {
  it("prefetches exactly the per-job keys, and every one is a real key", () => {
    const prefetched = PREFETCHED_KEYS.map((build) => build("JOB"));
    const known = Object.values(cacheKeys).map((build) => build("JOB"));
    for (const key of prefetched) expect(known).toContain(key);
    // The job LIST is deliberately not prefetched per job.
    expect(prefetched).not.toContain(cacheKeys.jobs());
    expect(new Set(prefetched).size).toBe(prefetched.length);
  });

  it("writes a key for every per-job section a screen reads", () => {
    // Derived from the screens rather than restated: a new section that
    // caches but is never prefetched fails here.
    const read = new Set<string>();
    for (const file of sources()) {
      for (const match of readFileSync(file, "utf8").matchAll(/cacheKeys\.(\w+)\(/g)) {
        read.add(match[1]);
      }
    }
    read.delete("jobs");

    const prefetched = new Set(
      PREFETCHED_KEYS.map((build) => {
        const key = build("JOB");
        return Object.entries(cacheKeys).find(([, make]) => make("JOB") === key)![0];
      }),
    );

    const missing = [...read].filter((name) => !prefetched.has(name));
    expect(missing, `screens read these but the prefetch never fills them: ${missing.join(", ")}`).toEqual([]);
    expect(read.size).toBeGreaterThan(4);
  });

  it("leaves no screen fetching a list without the cache", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const name = rel(file).replace(/^app\//, "");
      if (NOT_CACHED[name]) continue;
      const text = readFileSync(file, "utf8");
      const fetches = /api\.list\w+\(/.test(text);
      // `use-field-reports` holds the cached read for the reports screen;
      // the prefetch fills the same keys with `cacheSet` and no screen.
      const caches =
        text.includes("cachedRead") || text.includes("useFieldReports") || text.includes("cacheSet(");
      if (fetches && !caches) offenders.push(name);
    }
    expect(offenders, `these screens fetch a list with no offline fallback: ${offenders.join(", ")}`).toEqual([]);
  });

  it("lets no screen bail on a missing token before it reads its cache", () => {
    // THE REGRESSION THIS EXISTS FOR, found on a phone in Airplane Mode
    // on 2026-09-20. Every screen was written as
    //
    //     const token = await getToken();
    //     if (!token) return;            // ← never reaches the cache
    //     const result = await cachedRead(...)
    //
    // and Clerk refreshes the session JWT over the NETWORK, so offline
    // `getToken()` answers null. The punch list therefore fell back to
    // its initial state and said "Nothing outstanding on this job." —
    // the exact bug the caching layer was built to kill, reintroduced by
    // the refactor that unified it.
    //
    // The census before this one asked whether a screen CALLS cachedRead.
    // It does. It could not ask whether the call is REACHABLE, which is a
    // different question and the one that mattered.
    //
    // AND THEN THIS RULE MISSED FIVE SCREENS, which is why it no longer
    // matches one spelling of one line. It required `if (!token) return;`
    // exactly; materials, safety, time, photos and T&M tickets all wrote
    // `if (!token || !jobId) return;` and sailed through for as long as
    // the rule existed. Any early return on a falsy token now fails.
    const offenders: string[] = [];
    for (const file of sources()) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("cachedRead(")) continue;
      // The comment in cached-read.ts quotes the bad pattern on purpose.
      if (file.endsWith("cached-read.ts")) continue;
      for (const line of text.split("\n")) {
        const code = line.trimStart();
        if (code.startsWith("//") || code.startsWith("*")) continue;
        // A BARE `return;` — the loader giving up. `return false` from a
        // predicate ("is there anything to send?") is a different thing
        // and is allowed: it does not stand between a screen and its
        // cache.
        if (/^if \(!token\b[^)]*\)\s*return;/.test(code)) offenders.push(rel(file));
      }
    }
    expect(
      offenders,
      `these read through the cache but return early without a token, so offline they never reach it: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("waits for a token with a deadline, everywhere, because offline Clerk takes 2m42s", () => {
    // The device bug of 2026-09-20, after #398 had already fixed the
    // early return. Offline, `getToken()` does not answer null — it
    // retries for about two and a half minutes first (the arithmetic is
    // in lib/clerk-token.ts, read out of the installed clerk-js). Home's
    // load never finished, so it kept yesterday's lines and never drew
    // its "no connection" note: the note was not missing, it was 162
    // seconds away.
    //
    // So no file waits on Clerk directly. `tokenOrNull` is the only
    // caller, and it has the deadline.
    const offenders: string[] = [];
    for (const file of sources()) {
      if (file.endsWith("clerk-token.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const line of text.split("\n")) {
        // A comment quoting the bad line is not the bad line — the same
        // allowance cached-read.ts needs for its own worked example.
        const code = line.trimStart();
        if (code.startsWith("//") || code.startsWith("*")) continue;
        if (/\bawait getToken\(\)/.test(code)) offenders.push(rel(file));
      }
    }
    expect(
      offenders,
      `these await Clerk's getToken() directly, which offline blocks for ~2m42s — use tokenOrNull/withToken: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("puts no screen's list behind its queue flush", () => {
    // ROUND THREE of the same report, 2026-09-20: with no signal the
    // seven queue-backed screens — punch list, field reports, time,
    // photos, materials, safety, T&M — showed no rows and no "no
    // connection" note, while Home, Jobs, drawings and the schedule
    // showed both. Same cache, same component, same sentence. The
    // difference was ORDER: those seven refreshed their list only after
    // awaiting a token and a queue flush aimed at a server that was not
    // answering, and `flushQueue` hands every caller the SAME in-flight
    // promise, so one stuck upload holds all of them at once.
    //
    // `syncOnce` (lib/sync-order.ts) owns that order now and is tested
    // against a flush that never resolves. So anything that flushes must
    // go through it rather than sequencing the two itself.
    const offenders: string[] = [];
    for (const file of sources()) {
      if (file.endsWith("sync-queue.ts") || file.endsWith("sync-order.ts")) continue;
      const name = rel(file);
      if (FLUSH_WITHOUT_LIST[name]) continue;
      const text = readFileSync(file, "utf8");
      if (!/\bflushQueue\(/.test(text)) continue;
      if (!text.includes("syncOnce(")) offenders.push(name);
    }
    expect(
      offenders,
      `these flush the queue without syncOnce, so their list can end up behind it: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the flush exceptions honest — neither draws a cached list", () => {
    // The rule above is about a LIST waiting behind a flush. These two
    // have no cached list, which is the whole of why they are exempt — so
    // the day one of them grows a `cachedRead`, it stops being exempt.
    for (const [name, reason] of Object.entries(FLUSH_WITHOUT_LIST)) {
      const text = readFileSync(join(ROOT, name), "utf8");
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(10);
      expect(text.includes("cachedRead("), `${name} now reads a cached list — route it through syncOnce`).toBe(false);
      expect(/\bflushQueue\(/.test(text), `${name} no longer flushes — drop the exception`).toBe(true);
    }
  });

  it("keeps the exception list honest — every entry still exists and still skips the cache", () => {
    for (const [name, reason] of Object.entries(NOT_CACHED)) {
      const text = readFileSync(join(APP, name), "utf8");
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(10);
      expect(/api\.list\w+\(/.test(text), `${name} now fetches a list — cache it or drop the exception`).toBe(false);
    }
  });
});
