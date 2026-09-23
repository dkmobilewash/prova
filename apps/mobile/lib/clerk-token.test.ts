import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOKEN_WAIT_MS, tokenOrNull } from "./clerk-token";

/**
 * The deadline on asking Clerk for a token.
 *
 * The bug, on a real phone in Airplane Mode on 2026-09-20: Home showed
 * yesterday's lines and no "no connection" note, while every other screen
 * showed theirs. Nothing was wrong with Home's logic — its load simply had
 * not finished. Offline, `getToken()` retries for about two and a half
 * minutes before answering (see clerk-token.ts for the arithmetic, read
 * out of the installed @clerk/clerk-js), and every screen's offline
 * fallback is behind that call. The screens opened within a minute of
 * losing signal looked fine because Clerk still had a valid JWT cached;
 * Home was opened last.
 */

/** What Clerk actually does offline: 9 attempts, 8 waits, factor 1.55 from
 * 3s, capped at 50s. Not a guess — the numbers are its own. */
const CLERK_OFFLINE_MS = [0, 1, 2, 3, 4, 5, 6, 7].reduce(
  (total, n) => total + Math.min(50_000, 3000 * 1.55 ** n),
  0,
);

describe("waiting for a session token", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives up long before Clerk does, so the screen can read its cache", async () => {
    expect(Math.round(CLERK_OFFLINE_MS / 1000)).toBe(162);

    // Clerk's real offline behaviour: it answers, eventually.
    const clerk = () => new Promise<string | null>((resolve) => setTimeout(() => resolve(null), CLERK_OFFLINE_MS));

    const waiting = tokenOrNull(clerk);
    let answered = false;
    void waiting.then(() => {
      answered = true;
    });

    await vi.advanceTimersByTimeAsync(TOKEN_WAIT_MS - 1);
    expect(answered, "answered before its own deadline").toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    expect(await waiting).toBeNull();
    // The screen is drawing cached rows 158 seconds before Clerk speaks.
    expect(CLERK_OFFLINE_MS - TOKEN_WAIT_MS).toBeGreaterThan(150_000);
  });

  it("keeps the deadline short enough to be a deadline", () => {
    // A guard against the flaky-test fix that quietly restores the bug:
    // anything past a few seconds on a jobsite phone is the two-minute
    // hang again, wearing a smaller number.
    expect(TOKEN_WAIT_MS).toBeGreaterThanOrEqual(1000);
    expect(TOKEN_WAIT_MS).toBeLessThanOrEqual(10_000);
  });

  it("hands over a token that arrives in time, untouched", async () => {
    const quick = () => new Promise<string | null>((resolve) => setTimeout(() => resolve("jwt_abc"), 250));
    const waiting = tokenOrNull(quick);
    await vi.advanceTimersByTimeAsync(300);
    expect(await waiting).toBe("jwt_abc");
  });

  it("treats a thrown Clerk error as no token rather than a crash", async () => {
    // Signed out, a 401, or Clerk finally giving up minutes after we
    // stopped waiting — all of them are "no token", and none of them may
    // surface as an unhandled rejection.
    const angry = () => Promise.reject(new Error("Network request failed while offline"));
    await expect(tokenOrNull(angry)).resolves.toBeNull();

    const slowAndAngry = () =>
      new Promise<string | null>((_, reject) => setTimeout(() => reject(new Error("gave up")), CLERK_OFFLINE_MS));
    const waiting = tokenOrNull(slowAndAngry);
    await vi.advanceTimersByTimeAsync(TOKEN_WAIT_MS + 1);
    expect(await waiting).toBeNull();
    await vi.advanceTimersByTimeAsync(CLERK_OFFLINE_MS);
  });
});
