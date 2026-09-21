### Offline reads no longer need a token they cannot get (Diego)
`diego/offline-reads-need-no-token`

The whole caching layer did nothing offline, and Diego found it in one
pass with the radio off: the punch list said **"Nothing outstanding on
this job."** — the exact sentence the layer was built to kill — the
schedule said nobody was scheduled, drawings were empty, and Home showed
no offline line at all.

Every screen was written the same way:

    const token = await getToken();
    if (!token) return;            // ← never reaches the cache
    const result = await cachedRead(key, () => api.list(jobId, token));

**Clerk refreshes the session JWT over the network**, so with no signal
`getToken()` answers null and every one of those screens returned before
touching its own cache. The cache was full and unread.

The token is fetched INSIDE the read now (`withToken`), so a missing one
fails exactly like a dead network and the fallback can see it. The two
sync hooks had the same shape and skipped their refresh entirely without
a token, so a screen reopened offline never re-read the cache either.

**The census could not have caught this, and that is the lesson.**
`cache-parity.test.ts` asked whether a screen CALLS `cachedRead`. It
does — every one of them. It could not ask whether the call was
REACHABLE, which is a different question and the only one that mattered.
Same family as the scope-vs-size scar in this file: a check answers what
it was pointed at, and being green says nothing about the question
nobody asked. It now fails the build on `if (!token) return;` in any file
that reads through the cache, mutation-tested by putting the line back.

Found by turning the radio off on a real phone, which is the only place
this could have been found: every unit test mocks the token, every
dbtest calls the route directly, and neither has ever met Clerk.
