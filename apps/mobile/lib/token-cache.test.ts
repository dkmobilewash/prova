import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The token cache, and the hang it exists to prevent.
 *
 * Sharing one SecureStore key between two Clerk instances let a build
 * read a token the OTHER instance minted. Clerk cannot validate it, so
 * the app sat with `isLoaded` false — not signed out, not signed in,
 * just stopped. Then the first fix used a `:` as the separator, which
 * SecureStore rejects outright, and produced the same hang by a
 * different route. Both failures are silent from inside the app, which
 * is why they are pinned here rather than left to a launch.
 */

const store = new Map<string, string>();
const setItem = vi.fn(async (key: string, value: string) => {
  // The real SecureStore refuses anything outside this set. Reproduced,
  // because the bug that shipped was a key it refused.
  if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error("Invalid key provided to SecureStore");
  store.set(key, value);
});
const getItem = vi.fn(async (key: string) => {
  if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error("Invalid key provided to SecureStore");
  return store.get(key) ?? null;
});

vi.mock("expo-secure-store", () => ({
  getItemAsync: (key: string) => getItem(key),
  setItemAsync: (key: string, value: string) => setItem(key, value),
}));

vi.mock("./env", () => ({ clerkPublishableKey: "pk_live_Y2xlcmsuY3N0cmVhbS5haSQ" }));

const { namespacedKey, tokenCache } = await import("./token-cache");

beforeEach(() => {
  store.clear();
  setItem.mockClear();
  getItem.mockClear();
});

describe("the key a token is stored under", () => {
  it("carries the instance, so two instances cannot read each other's token", () => {
    const dev = namespacedKey("pk_test_aaa", "session");
    const live = namespacedKey("pk_live_bbb", "session");
    expect(dev).not.toBe(live);
    expect(dev).toContain("session");
  });

  it("is a key SecureStore will actually accept", () => {
    // The shipped bug: a ':' separator threw and stalled Clerk init.
    expect(namespacedKey("pk_live_Y2xlcmsuY3N0cmVhbS5haSQ", "__clerk_client_jwt")).toMatch(
      /^[A-Za-z0-9._-]+$/,
    );
  });

  it("strips anything SecureStore would refuse from the key itself", () => {
    // Never observed — 200,000 generated Clerk hosts produced no such
    // key — but the whole class costs one replace to remove.
    expect(namespacedKey("pk_live_ab+cd/ef=", "session")).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("still returns a usable key when there is no publishable key at all", () => {
    // An install with none cannot reach Clerk (env.ts refuses to render),
    // but the cache must not produce a key starting with the separator.
    expect(namespacedKey("", "session")).toBe("session");
  });
});

describe("reading and writing through it", () => {
  it("round-trips a token under the namespaced key", async () => {
    await tokenCache.saveToken("session", "a-token");
    expect(setItem).toHaveBeenCalledWith(
      "pk_live_Y2xlcmsuY3N0cmVhbS5haSQ_session",
      "a-token",
    );
    expect(await tokenCache.getToken("session")).toBe("a-token");
  });

  it("answers null rather than throwing when the read fails", async () => {
    getItem.mockRejectedValueOnce(new Error("keychain unavailable"));
    expect(await tokenCache.getToken("session")).toBeNull();
  });

  it("SWALLOWS a failed write, because a cache miss must not block sign-in", async () => {
    // A throw here propagates into Clerk's init and hangs the app — the
    // same stopped state as the other two bugs.
    setItem.mockRejectedValueOnce(new Error("keychain full"));
    await expect(tokenCache.saveToken("session", "a-token")).resolves.toBeUndefined();
  });
});
