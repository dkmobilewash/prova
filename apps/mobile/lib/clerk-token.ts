/**
 * Asking Clerk for a session token, with a deadline.
 *
 * WHY THIS FILE EXISTS, and the number is the whole point.
 *
 * Offline, `getToken()` does not answer null quickly. It answers after
 * about **two minutes and forty-two seconds**. Read out of the installed
 * `@clerk/clerk-js@6.32.0` (`dist/clerk.native.js`), not assumed:
 *
 *     getToken = async e => { ... await retry(() => this._getToken(e), {
 *       factor: 1.55, initialDelay: 3e3, maxDelayBetweenRetries: 5e4,
 *       jitter: !1, shouldRetry: (e,t) => (...) && (k() ? t <= 8 : t <= 3)
 *     }) ... }
 *
 * `k()` is `navigator` present AND `navigator.onLine` not `false`. React
 * Native has a `navigator` and no `onLine`, so on a phone k() is TRUE and
 * the long branch is the one we get: nine attempts, eight waits of
 * 3.0, 4.7, 7.2, 11.2, 17.3, 26.8, 41.6 and 50.0 seconds.
 *
 * That is what was wrong on the phone on 2026-09-20 after #398. Every
 * screen's offline fallback waits for a token, so every screen's
 * fallback waited for that. The screens opened within a minute of losing
 * signal looked fine — Clerk serves the cached JWT until five seconds
 * before it expires, and those are 60-second tokens — and Home, opened
 * last, had to go to the network and simply never finished loading. No
 * error, no banner, yesterday's lines still on screen. The offline note
 * was not missing; it was two and a half minutes away.
 *
 * So a screen waits `TOKEN_WAIT_MS` and then reads its own cache. A
 * jobsite phone that cannot produce a token in four seconds is offline
 * for every practical purpose, and showing last-known work with "no
 * connection" on it is the right answer whether the network is dead or
 * merely hopeless. Clerk's own attempt is left running — it cannot be
 * cancelled — and its eventual rejection is swallowed here rather than
 * surfacing as an unhandled rejection minutes later.
 */

/** How long any screen waits for a token before falling back to cache.
 * Below Clerk's FIRST retry delay (3s) plus a second of slack, so a
 * healthy refresh always wins the race and a dead one never holds a
 * screen. */
export const TOKEN_WAIT_MS = 4000;

export async function tokenOrNull(
  getToken: () => Promise<string | null>,
  waitMs: number = TOKEN_WAIT_MS,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      // A rejection is a missing token, not a crash: signed out, a 401,
      // or Clerk finally giving up long after we stopped waiting.
      getToken().catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), waitMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
