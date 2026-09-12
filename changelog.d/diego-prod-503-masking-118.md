### A silent 503 on a live navigation or a Server Action is now visible — #118, partial (Diego)
`diego/prod-503-masking-118`

**This does not explain or fix why production returns 5xx on some RSC
navigation fetches and Server Action POSTs.** That root cause is still
unresolved — see the investigation notes below and issue #118 for the
full account. What ships here is the one thing this session could verify
and fix without production access: turning a previously completely
silent failure into a visible, dismissible message.

**Mechanism (`lib/rsc-fetch-guard.ts`, mounted as `RscFailureBanner` next
to the existing `StaleDeployBanner`).** Wraps `window.fetch`, classifies
each request by the header names read directly out of the installed
`next@15.5.23` package (`next-action` for a Server Action POST; `rsc`
without `next-router-prefetch` for a live navigation fetch — a
background prefetch is deliberately excluded, since a failed prefetch by
itself has no user-visible consequence and alerting on it would be
noise), and fires a callback on a 5xx or a thrown network error. Every
branch returns or rethrows EXACTLY what the wrapped `fetch` produced —
no retry, no response substitution. Server Action failures say not to
resubmit before checking (mirrors `(app)/error.tsx`'s existing #19
pattern — CLAUDE.md's "no create action is idempotent" scar means a
blind auto-retry of a write that actually completed server-side but
503'd on the way back could duplicate money or evidence); navigation
failures say the page might not be current.

**Why no retry-and-swap, which was the first draft.** Reading
`fetch-server-response.js` in the installed package shows Next only
issues a live fetch for a navigation when its prefetch cache entry is
stale/expired — when a fresh entry exists, the render uses that entry's
already-resolved data and doesn't wait on a new request at all. So a
failing `_rsc=` GET seen in the Network tab may not be the request the
render depends on, and swapping in a different `Response` there fixes
nothing observable while adding risk this session cannot test against a
real production 503. Also newly established from the same reading: a
genuinely FRESH navigation fetch (no usable cache entry) that gets a
non-ok response does NOT render stale data — it resolves with a bare URL
string, which `navigate-reducer.js` routes through a full MPA
navigation. The silent-stale-render shape in #118's own repro is
therefore specific to a prefetch-cache-hit, not Next unconditionally
swallowing every failed navigation.

**Verified:** 17 new unit tests against a mocked `fetch` (real production
503s are not reproducible locally or from an agent container — see
CLAUDE.md), three mutated by hand (inverting the prefetch exclusion,
widening the 5xx range to include 4xx, removing the abort guard) and
confirmed each kills the tests meant to catch it. `typecheck`, `lint`,
full unit suite (125 files / 2181 tests), production build, and
`./scripts/preflight.sh` all green. No migration.

**Investigation findings, honestly incomplete — this is the part someone
with more access should pick up:**

- Vercel's Hobby-plan runtime log retention is **one hour**, not the ~24h
  assumed going in — confirmed by `get_runtime_logs` explicitly saying so
  once a wider window was tried, after two silent empty results at 24h/6h
  windows didn't say why. This is new and matters: no session investigating
  this issue after the fact, even minutes later, can pull logs from the
  actual capture window described in the issue — only a session running
  *during* a live capture ever could, which is why every prior investigation
  had to instrument the browser itself instead.
- At the time of this session, `get_runtime_logs` (1h window, no filter)
  returned zero requests and `get_runtime_errors` (7d window) returned zero
  errors — there was no traffic of any kind to measure. That is itself a
  finding for a pre-launch product: the 503s observed on 2026-09-03 and
  2026-09-09 both came from a human/agent driving a real browser session
  against production; nothing hits `app.cstream.ai` between those sessions.
  This session could not reproduce or bound the failure rate, and says so
  rather than inventing a number.
- The zero-500s / zero-errors asymmetry from #221's investigation (a
  platform-level 503 or a killed connection would not register as an
  application throw) is consistent with everything read here and was not
  re-contradicted, but also could not be freshly re-measured given the
  point above.
- `connection_limit=5&pool_timeout=30&connect_timeout=30` (CLAUDE.md's own
  documented values, cross-checked against `packages/db/.env.example`'s
  shape) is unchanged. An older CHANGELOG entry ("Duplicate records from an
  exhausted pool: the half that's fixable") already diagnosed a plausible
  mechanism in detail — Neon closing an idle connection Prisma still
  believes it holds, which then drains the 5-connection pool under load
  that isn't actually heavy — and named the same three remaining options
  this issue's own body suggests: lower `pool_timeout` for a faster visible
  failure, lower `connection_limit` (serverless guidance is lower, not
  higher), or move to `@prisma/adapter-neon`'s stateless HTTP driver. All
  three are either a `DATABASE_URL` change on Vercel or a real Neon-backed
  branch of work — outside what this session can do or verify, exactly as
  CLAUDE.md's own Vercel-MCP note says (no env-var read/write tool exists).

**Recommendation for whoever has Vercel/Neon access:** the cheapest next
experiment is lowering `pool_timeout` on the pooled `DATABASE_URL` so a
pool problem fails fast and visibly instead of stalling — that alone
would show up immediately in `get_runtime_logs` grouped by status code,
if pulled *during* a deliberate click-through session rather than after
the fact given the one-hour retention above.
