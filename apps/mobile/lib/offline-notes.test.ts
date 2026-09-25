import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyFor } from "./empty-state";
import { EN } from "./strings/en";

/**
 * The guard `lib/empty-state.ts` has cited since it was written, and
 * which did not exist until now (issue #485).
 *
 * Its header says: *"`offline-notes.test.ts` fails the build on a cached
 * list screen that writes its own."* That sentence was true of an
 * intention and false of the repository — and a cited check that does
 * not exist is worse than no check, because everybody downstream reads
 * the citation and stops looking. `lib/i18n.ts` cited a second one
 * (`strings-census.test.ts`) twice, and the day somebody finally wrote
 * it, it found twelve dead keys and five shared components sitting in
 * English. Two phantom guards in one directory is a pattern.
 *
 * WHAT IT IS PROTECTING. "There is nothing here" and "I could not find
 * out" are different sentences, and on a jobsite the first is a CLAIM.
 * "Nothing outstanding on this job." read as a clean punch list to a
 * foreman standing in front of a wall that was not — reported from site
 * on 2026-09-20. `emptyFor` exists so that sentence is DERIVED from how
 * the load went, in one place, instead of typed per screen where it
 * cannot know.
 *
 * So a screen that reads through the cache must ask `emptyFor` what to
 * say. Typing its own empty state is how the fixed bug comes back.
 */

const root = join(__dirname, "..");

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

const screens = listFiles(join(root, "app")).filter((f) => f.endsWith(".tsx"));

/**
 * Screens that read through `cachedRead` and legitimately do NOT call
 * `emptyFor`, each with its reason. A screen missing from both this list
 * and the `emptyFor` callers is the bug.
 */
const NO_EMPTY_STATE: Record<string, string> = {
  "(tabs)/index.tsx":
    "Home is not a list — it draws a line per section from lib/today.ts and has its own two empty states for no-job and no-capability",
  "job/[jobId].tsx":
    "a hub of links to the per-job screens; it has no list of its own that could be empty or unloaded",
};

/**
 * `emptyFor` takes KEYS, not sentences — #489 changed it the same week
 * this file was written, and the merge of the two was textually clean and
 * type-broken: `emptyFor(null, "the photos", …)` compiled against the old
 * signature and nothing in either suite runs tsc. So the sentences are
 * read out of the dictionary here rather than restated, which also means
 * a reworded English string cannot fail this file for the wrong reason.
 */
describe("emptyFor says which of the two sentences is true", () => {
  it("distinguishes an empty list from one it could not load", () => {
    const loaded = emptyFor(null, "thing.photos", { title: "photos.empty.title" });
    const unloaded = emptyFor("nothing", "thing.photos", { title: "photos.empty.title" });
    expect(loaded.emptyTitle).toBe(EN["photos.empty.title"]);
    expect(unloaded.emptyTitle).toBe(
      EN["offline.cantLoad"].replace("{thing}", EN["thing.photos"]),
    );
    // The one that matters: the unloaded case must NEVER render the
    // screen's own claim, because that claim is about data it never saw.
    expect(unloaded.emptyTitle).not.toBe(loaded.emptyTitle);
  });

  it("says what happens to anything added while it cannot load", () => {
    // Somebody standing in a basement needs to know the write is kept.
    const unloaded = emptyFor("nothing", "thing.punchList", { title: "punch.empty.title" });
    expect(unloaded.emptyDescription).toMatch(/kept and sent/);
  });

  it("passes a stale load through as a real empty state, not an error", () => {
    // `loadedFrom` is a note like "2 hours ago" — the list DID load, from
    // the cache, so an empty one is genuinely empty.
    const stale = emptyFor("2 hours ago", "thing.photos", { title: "photos.empty.title" });
    expect(stale.emptyTitle).toBe(EN["photos.empty.title"]);
  });
});

describe("no cached list screen writes its own empty state", () => {
  const cached = screens.filter((f) => readFileSync(f, "utf8").includes("cachedRead("));

  it("finds the cached list screens at all", () => {
    // Vacuity guard: if `cachedRead` is ever renamed, this file would
    // otherwise pass by having nothing to check.
    expect(cached.length, "no screen appears to read through the cache — the pattern has stopped matching").toBeGreaterThan(6);
  });

  it("makes every exclusion say why", () => {
    for (const [screen, reason] of Object.entries(NO_EMPTY_STATE)) {
      expect(reason.length, `${screen} needs a real reason`).toBeGreaterThan(20);
      expect(
        screens.some((f) => f.endsWith(join("app", ...screen.split("/")))),
        `${screen} is excluded but does not exist`,
      ).toBe(true);
    }
  });

  it("routes every cached screen's empty state through emptyFor", () => {
    const offenders: string[] = [];
    for (const file of cached) {
      const rel = file.slice(join(root, "app").length + 1);
      if (rel in NO_EMPTY_STATE) continue;
      if (!readFileSync(file, "utf8").includes("emptyFor(")) offenders.push(rel);
    }
    expect(
      offenders,
      `these read through the cache but write their own empty state, so they cannot tell "nothing here" from "couldn't load": ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
