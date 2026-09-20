import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one policy every screen reads through.
 *
 * The bug it exists to prevent, found on site 2026-09-20: with no signal
 * the punch list rendered "Nothing outstanding on this job." — its empty
 * state, because the fetch failed and the screen had nothing else to
 * draw. On a jobsite that is a claim, not a blank page.
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

const { cachedRead, couldNotLoad, staleNote } = await import("./cached-read");

beforeEach(() => store.clear());

describe("reading a list that may have no signal behind it", () => {
  it("returns the server's answer and keeps it", async () => {
    const first = await cachedRead("punch-list.job_1", async () => ["a", "b"]);
    expect(first).toMatchObject({ from: "server", value: ["a", "b"] });
    expect(staleNote(first)).toBeNull();

    // The same key now survives a failure.
    const second = await cachedRead("punch-list.job_1", async () => {
      throw new TypeError("Network request failed");
    });
    expect(second).toMatchObject({ from: "cache", value: ["a", "b"] });
  });

  it("says how old the fallback is, in words a person reads", async () => {
    await cachedRead("reports.job_1", async () => [1]);
    const cached = await cachedRead("reports.job_1", async () => {
      throw new Error("offline");
    });
    expect(staleNote(cached)).toMatch(/Showing what this phone last loaded, just now — no connection/);
  });

  it("distinguishes 'could not load' from 'there is nothing here'", async () => {
    // The whole point. Nothing cached and no signal is not emptiness.
    const nothing = await cachedRead("time.job_9", async () => {
      throw new Error("offline");
    });
    expect(nothing).toEqual({ from: "nothing" });
    expect(couldNotLoad(nothing)).toBe(true);

    // An empty list FROM THE SERVER is emptiness, and must not be
    // confused with the case above.
    const empty = await cachedRead("time.job_8", async () => []);
    expect(empty).toMatchObject({ from: "server", value: [] });
    expect(couldNotLoad(empty)).toBe(false);
  });

  it("caches whatever shape it is given, so a two-list screen stays consistent", async () => {
    await cachedRead("safety.job_1", async () => ({ talks: [1], incidents: [2, 3] }));
    const cached = await cachedRead("safety.job_1", async () => {
      throw new Error("offline");
    });
    expect(cached).toMatchObject({ from: "cache", value: { talks: [1], incidents: [2, 3] } });
  });

  it("overwrites the cache on every success, so nothing goes stale in place", async () => {
    await cachedRead("jobs", async () => ["old"]);
    await cachedRead("jobs", async () => ["new"]);
    const cached = await cachedRead("jobs", async () => {
      throw new Error("offline");
    });
    expect(cached).toMatchObject({ value: ["new"] });
  });
});
