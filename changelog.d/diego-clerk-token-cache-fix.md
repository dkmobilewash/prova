### The phone stops reading the other Clerk instance's session token (Diego)
`diego/clerk-token-cache-fix`

Mobile only, and it is the fix for an app that does not crash, does not sign
you out, and does not start — it sits on the splash with `isLoaded` false
forever. Two separate ways to reach that same stopped state, both now pinned
by tests rather than by a comment.

**One SecureStore key for two Clerk instances.** There are two (three, counting
Cyrus's laptop app — the table in CLAUDE.md names them), they mint tokens that
look alike, and neither can validate the other's. Sharing one storage key meant
a build could read a token the OTHER instance issued: Clerk cannot validate it
and does not give up on it either, so the app never finishes initialising. The
key now carries the publishable key as a prefix, which makes switching
instances a sign-out — the honest outcome, and the one a person can act on.

**Then the fix itself shipped the same hang by a different route.** The first
version used `:` as the separator. SecureStore accepts only alphanumerics, `.`,
`-` and `_` in a key, so every read and write threw `Invalid key provided to
SecureStore` — swallowed by the cache's own try/catch, which is correct for a
cache and is exactly why nothing said so. Same symptom, nothing in the log.

**What is actually new here, beyond the two-line fix.** The cache was an
anonymous object literal inside `app/_layout.tsx`, which is why neither bug was
testable and why the second one got written. It is `lib/token-cache.ts` now,
with `namespacedKey()` exported as a pure function, and
`lib/token-cache.test.ts` mocks SecureStore with **the real character rule** —
the mock rejects any key outside `[A-Za-z0-9._-]`, so the separator bug is a
failing test rather than a code review someone has to remember to do. Seven
cases: the two instances cannot collide, the key is one SecureStore accepts, a
read that fails answers `null`, and a write that fails is **swallowed** —
because a cache write throwing into Clerk's init is the third road to the same
stopped app.

Mutation-tested both ways rather than asserted: dropping the namespace turns
two cases red, and letting a failed write propagate turns the swallow case red.

One belt-and-braces line is called out in the source so nobody takes it for a
fix to something observed: the publishable key is base64 with padding stripped,
so it could in principle carry `+` or `/`. 200,000 generated Clerk hostnames
produced no such key — ASCII hostname bytes never reach those symbols — but the
strip costs one `replace` and removes the class.
