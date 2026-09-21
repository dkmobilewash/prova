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

describe("a read that needs a token", () => {
  it("falls back to the cache when there is no token, instead of showing nothing", async () => {
    // The device bug: Clerk refreshes the session JWT over the network,
    // so offline `getToken()` answers null. A screen that bailed on that
    // never reached its own cache and rendered its empty state — "Nothing
    // outstanding on this job." on a job with plenty outstanding.
    const { withToken } = await import("./cached-read");

    await cachedRead("punch-list.job_7", withToken(async () => "token", async () => ["fix the grid"]));

    const offline = await cachedRead(
      "punch-list.job_7",
      withToken(
        async () => null,
        async () => {
          throw new Error("should never be called without a token");
        },
      ),
    );
    expect(offline).toMatchObject({ from: "cache", value: ["fix the grid"] });
  });

  it("stops waiting for a token that is two minutes away, and shows the cache", async () => {
    // THE DEVICE BUG OF 2026-09-20, the second one. Offline `getToken()`
    // does not answer null — it retries for about two and a half minutes
    // first. Home's load therefore never finished, so it kept the lines
    // from its last online load and never drew its "no connection" note:
    // the note was not missing, it was 162 seconds away.
    const { withToken } = await import("./cached-read");
    const { TOKEN_WAIT_MS } = await import("./clerk-token");

    await cachedRead("time.job_5", withToken(async () => "token", async () => ["8 hours"]));

    vi.useFakeTimers();
    try {
      const offline = cachedRead(
        "time.job_5",
        withToken(
          () => new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 162_000)),
          async () => ["never asked"],
        ),
      );
      await vi.advanceTimersByTimeAsync(TOKEN_WAIT_MS + 1);
      expect(await offline).toMatchObject({ from: "cache", value: ["8 hours"] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing rather than empty when there is no token AND no cache", async () => {
    const { withToken } = await import("./cached-read");
    const first = await cachedRead("safety.job_7", withToken(async () => null, async () => ["never"]));
    expect(first).toEqual({ from: "nothing" });
  });
});

describe("a screen made of several cached lists", () => {
  it("reports the OLDEST of them, because a screen is as fresh as its stalest part", async () => {
    const { oldestNote } = await import("./cached-read");

    // Home is four lists. It used to say "Showing what this phone last
    // loaded — no connection" with no age at all, which is the one thing
    // a person standing in a basement wants from that sentence.
    const old = { from: "cache" as const, value: [], note: "two days ago", at: "2026-09-18T10:00:00.000Z" };
    const newer = { from: "cache" as const, value: [], note: "ten minutes ago", at: "2026-09-20T18:00:00.000Z" };
    const fresh = { from: "server" as const, value: [] };

    expect(oldestNote([fresh, newer, old])).toBe("two days ago");
    expect(oldestNote([old, newer])).toBe("two days ago");
    expect(oldestNote([fresh, fresh])).toBeNull();
    expect(oldestNote([{ from: "nothing" }, fresh])).toBeNull();
  });
});
