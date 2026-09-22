### The first two screens a pilot contractor touches now tell the truth (Cyrus)
`cyrus/first-screen-truth`

Two defects a pilot contractor hit in his first session, in one PR because
they are one capability: the screens somebody meets first have to be
believable.

**Certified payroll printed `35.300000000000004`.** `TimeEntry.hours` is
`Decimal(5,2)` and every figure on that page is a floating-point sum of
many of them — `7 + 7 + 7 + 7.1 + 7.2` is not `35.3` in JavaScript. Five
places on the page rendered the raw number while the MONEY on the same
line already went through `money()`. That is the one screen whose whole
purpose is to be believed by somebody who checks arithmetic for a living
and then files the result with a government agency.

**The fix is not five fixes, and that is the point.** This bug had already
been found and fixed TWICE before that page printed it — `hoursCell` on
the WH-347 page next door, and `formatLoggedHours` in `lib/wip.ts` (issue
#287). Both older than the defect, both correct, neither able to stop it,
because a fix at a call site protects that call site and nothing else.
There were three implementations of the same rounding in the repo and a
fourth screen printing the raw float between them.

So there is now one implementation, `lib/render-hours.ts`, and
`hoursRenderCensus.test.ts` fails the build when a second one appears or
when any screen renders hours without it. Thirteen more sites were found
and fixed by that census, on phase codes, union compliance, prevailing
wage, the WH-347 blocking note and the apprenticeship panel.

The census pins the two things CLAUDE.md records this repo getting wrong
before: its SCOPE, to `git ls-files` (nothing is ever missing from a
directory you do not walk — the `theme-contrast` scar), and its SIZE, to a
`git grep -o` count taken by a different tool over raw bytes (a pattern
that matches nothing passes every assertion downstream — the
`scratch-cleanup-order` scar). Both were mutation-tested: breaking the
brace scanner reports "git counts 33 formatter calls and this scan found
0" rather than going quietly green.

**Its blind spot is written into the file rather than discovered later.**
It finds hours by the NAME of what is rendered, so an hours value under a
generic name is invisible to it. Two real instances of this defect —
`splitLabel(split)` on prevailing wage and `StandingNote`'s
`done`/`required` props — carried no "hours" in the identifier and were
found by reading, not by the census.

**Global search offered results that 404.** A walkthrough's `route` is a
Next.js route PATTERN, and six of them are job-detail tabs written as
`/jobs/[id]/billing`. #386 set `href: match.route`, so searching "billing",
"crew", "estimate", "photos" or "field reports" offered a Pages row that
navigated to `/jobs/%5Bid%5D/billing` — "This page doesn't exist."

Those entries are now excluded rather than redirected. Pointing them at
`/jobs` was considered and rejected: there is no correct id to fill in, and
landing on the jobs list does not deliver billing — it trades a fast,
obvious 404 for a slow, silent dead end that is harder to report.

**It closed a capability hole nobody had reported.** `capabilityForRoute`
reads `ROUTE_CAPABILITY`, which is keyed on STATIC hrefs, so a dynamic
route resolves to `null` — open. Measured on `origin/main` before the fix:
a FIELD member searching "billing" or "estimate" was offered exactly what
an OWNER was, while every other page result did differ by role. Those six
were the only entries in the index bypassing the capability filter, and
they were the six that could not be opened anyway.

The cost is stated rather than buried: "billing" and "estimate" now return
no Pages result at all, because this app has no static billing or estimate
page. The fix for that is a page, not a link to a page shape.

**The search panel could hang on "Searching…" forever.** `searchApp`'s own
file comment promised it never throws and there was no `try` in the file;
`SearchLauncher` awaited it inside a `setTimeout(async () => …)` callback
with no `catch`. That callback is a floating promise, so a rejection was an
unhandled rejection and every line after the `await` — `setLoading(false)`
first among them — never ran. Not slow. Stuck, until the box was closed.
Any cause would do it: a cold Neon compute on `connection_limit=5`, a
dropped connection, a 500.

Fixed on both sides, because they fail differently: the action catches its
own providers, and `runSearch` in `lib/search/panel.ts` catches the
transport, which the server cannot. `requireCompanyContext()` is
deliberately OUTSIDE the action's `try` — it redirects a signed-out caller
and a redirect is a thrown control signal, so catching it would answer
"search is unavailable" to somebody who just needs to sign in. That naive
fix is mutation-tested as its own red case.

**And one reported defect that could not be confirmed, said plainly.** A
digit-only term longer than Postgres `integer` (a pasted phone number) was
passed to `Number()` and used as an `Int` filter in four providers. That it
THREW is NOT established — reproducing it needs a live Postgres and none
was reachable from this branch. The guard is right either way and for a
better reason: a value outside the column's range cannot equal any row, so
that filter could only ever return nothing. `recordNumberTerm` now drops
it, and a test reads `providers.ts` back to check no fifth provider copies
its neighbours' old inline `Number()`.

`app/(app)/phase-codes/page.tsx` is job costing, which WORK-SPLIT.md puts
in Diego's lane. Three display-only interpolations were changed there
rather than exempted, because a census that exempts a known-wrong screen is
not a census. Worth a ping before it merges.
