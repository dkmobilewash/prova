import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The last-known list a screen falls back on with no signal — and the
 * sentence that says how old it is.
 *
 * The bug behind this file: with no connection the punch list rendered its
 * empty state, "Nothing outstanding on this job.", which on a jobsite reads
 * as a claim that the job is clear rather than as a page that failed to
 * load.
 */

const store = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: async (k: string) => {
      store.delete(k);
    },
  },
}));

const { cacheAge, cacheGet, cacheSet } = await import("./offline-cache");

beforeEach(() => store.clear());

describe("the cache itself", () => {
  it("gives back what was written, with when", async () => {
    await cacheSet("punch-list.job_1", [{ id: "a" }]);
    const cached = await cacheGet<{ id: string }[]>("punch-list.job_1");
    expect(cached?.rows).toEqual([{ id: "a" }]);
    expect(Number.isNaN(Date.parse(cached!.at))).toBe(false);
  });

  it("is empty for a job this phone has never loaded", async () => {
    expect(await cacheGet("punch-list.never")).toBeNull();
  });

  it("treats a half-written or older-shaped entry as absent, not as data", async () => {
    store.set("prova.cache.punch-list.job_2", "{not json");
    expect(await cacheGet("punch-list.job_2")).toBeNull();

    store.set("prova.cache.punch-list.job_3", JSON.stringify([{ id: "a" }]));
    expect(await cacheGet("punch-list.job_3")).toBeNull();
  });

  it("keeps one entry per job", async () => {
    await cacheSet("punch-list.job_1", ["one"]);
    await cacheSet("punch-list.job_2", ["two"]);
    expect((await cacheGet<string[]>("punch-list.job_1"))?.rows).toEqual(["one"]);
    expect((await cacheGet<string[]>("punch-list.job_2"))?.rows).toEqual(["two"]);
  });
});

describe("how old it says the list is", () => {
  const now = new Date("2026-09-20T12:00:00.000Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60000).toISOString();

  it("says it plainly at each scale", () => {
    expect(cacheAge(ago(0), now)).toBe("just now");
    expect(cacheAge(ago(7), now)).toBe("7 min ago");
    expect(cacheAge(ago(60), now)).toBe("an hour ago");
    expect(cacheAge(ago(5 * 60), now)).toBe("5 hours ago");
    expect(cacheAge(ago(24 * 60), now)).toBe("yesterday");
    expect(cacheAge(ago(3 * 24 * 60), now)).toBe("3 days ago");
  });

  it("does not invent a future for a clock that disagrees", () => {
    // A phone whose clock moved, or a cache written on another timezone
    // boundary: "in -3 minutes" is worse than saying nothing precise.
    expect(cacheAge(new Date(now.getTime() + 60000).toISOString(), now)).toBe("earlier");
    expect(cacheAge("not a date", now)).toBe("earlier");
  });
});
