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

const APP = join(__dirname, "..", "app");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

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
    for (const file of files(APP)) {
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
    for (const file of files(APP)) {
      const name = file.slice(APP.length + 1);
      if (NOT_CACHED[name]) continue;
      const text = readFileSync(file, "utf8");
      const fetches = /api\.list\w+\(/.test(text);
      // `use-field-reports` holds the cached read for the reports screen.
      const caches = text.includes("cachedRead") || text.includes("useFieldReports");
      if (fetches && !caches) offenders.push(name);
    }
    expect(offenders, `these screens fetch a list with no offline fallback: ${offenders.join(", ")}`).toEqual([]);
  });

  it("keeps the exception list honest — every entry still exists and still skips the cache", () => {
    for (const [name, reason] of Object.entries(NOT_CACHED)) {
      const text = readFileSync(join(APP, name), "utf8");
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(10);
      expect(/api\.list\w+\(/.test(text), `${name} now fetches a list — cache it or drop the exception`).toBe(false);
    }
  });
});
