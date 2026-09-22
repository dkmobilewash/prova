### What actually changed, in plain English (Diego)
`diego/offline-token-wait`

The phone's offline note was not missing. It was two and a half minutes
away, and everything behind it was too.

Tested on a real phone in Airplane Mode on 2026-09-20, after #398: the
drawings and schedule screens showed their "Showing what this phone last
loaded — no connection" line, and Home showed the day's lines with no note
at all. Home's logic was right; its load had simply not finished.

`getToken()` does not answer null offline. It retries first — read out of
the installed `@clerk/clerk-js@6.32.0` (`dist/clerk.native.js`) rather than
assumed:

    getToken = async e => { ... retry(() => this._getToken(e), {
      factor: 1.55, initialDelay: 3e3, maxDelayBetweenRetries: 5e4,
      jitter: !1, shouldRetry: (e,t) => (...) && (k() ? t <= 8 : t <= 3) })

`k()` is "there is a `navigator` and its `onLine` is not `false`". React
Native has a `navigator` and no `onLine`, so a phone always gets the long
branch: nine attempts, eight waits of 3.0, 4.7, 7.2, 11.2, 17.3, 26.8,
41.6 and 50.0 seconds — **162 seconds** before it says "no token". Every
screen's offline fallback is behind that call, so every offline fallback
was 162 seconds behind it. Drawings and schedule looked fine only because
they were opened within a minute of losing signal, while Clerk still had a
valid JWT cached (60-second tokens, served until five seconds before they
expire). Home was opened last.

So a token now has a deadline: `tokenOrNull` waits four seconds — Clerk's
own first retry is at three — and then the screen reads its cache. Nothing
else in the app waits on Clerk directly, and the census fails the build if
anything does.

**And the same test found five screens still doing the thing #398 fixed.**
Materials, Safety, T&M, Time and Photos all still had

    const token = await getToken();
    if (!token || !jobId) return;      // ← never reaches the cache

The census added in #398 matched `if (!token) return;` exactly, so the
extra `|| !jobId` walked straight past it — and its file walk collected
`.tsx` only, which meant pointing it at `lib/` asked a question with no
files in it at all. `use-sync.ts` and `use-field-reports.ts` were never
scanned. Both holes are the shape CLAUDE.md already names for the SQL
census: a parser has two failure modes, and only one of them looks like a
failure. The walk now takes `.ts` too, asserts its own size so an empty
scan fails loudly, and matches any early return on a falsy token.

Checks: `lib/clerk-token.test.ts` runs Clerk's real 162-second schedule
against the deadline and fails if the token wait is removed (mutation-
tested — the suite times out); the two census rules were mutation-tested
by restoring the old bail-out and the old `.tsx`-only walk, and both go
red. Home also reports the OLDEST of its four lists rather than a sentence
with no age in it.
