### What actually changed, in plain English (Cyrus)
`cyrus/last-seen`

**ADDS A MIGRATION** — `20260913120000_add_user_last_seen_at`, one
nullable column: `User.lastSeenAt DateTime?`. Additive, no default, no
backfill, no constraint, nothing dropped, so it is safe against the real
data in `ep-little-sea`. Announced here because the working agreement says
a schema change is announced BEFORE the push, while objecting is still
cheap. The demo project (`ep-patient-lake`) gets nothing automatically —
run **Migrate demo database** or the usage page will 500 on a preview with
"column does not exist", which reads as a code bug and is not one.

**There was no usage visibility of any kind.** No `lastSeenAt`, no
analytics, nothing. Five design partners are getting logins, and the one
who quietly stops signing in was invisible until somebody noticed on a
weekly call — which is after the decision to leave has been made. The ones
who churn go quiet first, so "who has not been back in nine days" is the
single highest-value thing this product was not recording.

Three parts, and the smallest honest version of each:

- **One recorded fact.** `requireCompanyContext` runs on every
  authenticated request, so the stamp hangs off that and nothing has to be
  remembered at 40 call sites. Throttled to one write per person per 15
  minutes — chosen because the question is asked by a human reading a list
  once a day, so a quarter-hour is far finer than it needs, and it bounds
  the cost at 4 writes an hour instead of one per request. On the render
  that crosses the boundary the layout and the page can both write, since
  the App Router renders them concurrently; that is two idempotent writes
  of the same timestamp, at most once per interval, and it is in the
  comment rather than hidden.
- **The failure is swallowed, on purpose.** This write sits inside the one
  function every authenticated page awaits, so an unhandled rejection here
  is a 500 on every route in the product because a telemetry column could
  not be written. Neon suspends idle computes and the pool runs at
  `connection_limit=5`, so that is a real state. `recordLastSeen` catches,
  logs one line with no name or email, and returns `"failed"` — it returns
  an outcome rather than `void` precisely because a swallowed failure and a
  deliberate throttle are otherwise indistinguishable, which is the shape
  CLAUDE.md calls "cannot tell refuted from never ran".
- **Somewhere to read it**: `/internal/usage`, gated on the two things
  `/sales` is gated on and that no Capability can express —
  `Company.isProvaOperator` AND role OWNER. It is the only page in the app
  that reads across tenants, which is why nothing narrower would be
  honest. Not in any contractor's nav: it joins `/sales` in the operator-only
  "Internal" group, and that group's flag is now `showsInternal` rather than
  `showsSalesCrm`, because a flag named after one of the two pages it gates
  is a comment that disagrees with the code.

**Nothing about "active" is stored.** The column is a fact — a request
happened at this instant. Active / going quiet / quiet / never seen are
derived from it and the clock on every render, the per-company figure is the
newest of its people's timestamps, and even the row order is computed
(quietest first, so the call worth making does not need scrolling to).
There is no status flag anywhere for a stale value to disagree with.

**The null is load-bearing and the page says so out loud.** Backfilling
from `createdAt` was rejected: it would invent a visit that may never have
happened, and an unused login is exactly the row this exists to surface. So
"Never seen" means "nothing recorded since this shipped", the page says
that in as many words, and for the first fortnight it will be most of the
list.

**The specific checks.** `shouldStampLastSeen` is pinned at its exact
boundaries — one millisecond inside the interval writes nothing, the
interval itself writes, and a stored timestamp in the FUTURE writes rather
than freezing the column until real time catches up. The swallow is proved
by making the update throw and asserting the page still gets its context
AND that the write was attempted, so it cannot pass by never trying. All
four were mutation-tested: removing the try/catch reddens the two swallow
tests with `Error: simulated database failure: user.update`; making the
throttle always true reddens three with `expected [ 'user.update' ] to
deeply equal []`; unwiring the stamp from `requireCompanyContext` reddens
four; dropping the nav entry reddens two.
