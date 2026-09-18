### A new pursuit shows up the moment you save it, and every page's server work is about a quarter shorter (Cyrus)
`cyrus/fast-lists`

**What was wrong.** On /pipeline, "Add pursuit" closed the form straight
away, but the list kept saying "Nothing on the chase list yet" for 3 to 10
seconds on a laptop dev server. That is exactly the gap in which someone
clicks Save a second time. It is the shape CLAUDE.md's #61 entry already
pinned down: the action says `ok` around 1.5s, and the refreshed page that
carries the new row finishes arriving seconds later. It was not a lost
update.

**The list now shows the save itself.** `useOptimistic` puts the typed row
in the list, marked "saving…" and with no buttons, while the action is in
flight, and takes it out again if the action refuses (the error shows and
what you typed stays). A confirmed create, edit, stage move or delete is
then held against the exact `pursuits` array it was made over, and dropped
the moment a new one arrives. So the server's list always wins, and the
held copy never outlives one refresh. The hold is needed because
`useOptimistic` alone lets go when the action answers, and that is before
the refreshed list lands, so the row would have flashed out. The submit
button stays disabled while a create is in flight, and "Add a pursuit"
(and "Add the first one") is rendered disabled until the page hydrates.
Before, a click that landed first did nothing, with nothing on screen to
say so.

**Where the server time went, measured rather than guessed.** A throwaway
script called the real (app) layout and /pipeline loaders read-only against
`ep-icy-hat` (5 jobs, 19 time entries) and logged every query with its
timestamps. The layout re-renders after every Server Action. Its bell count,
Money Rail and metric bar were 62 queries, and the critical path was one
chain:

| loader | before | after | why |
| --- | --- | --- | --- |
| `loadAlerts` job read | 10 queries in series, ~1.0s | 2 rounds | 9 relations nested under `Job`, and Prisma runs sibling relations one after another |
| `loadRatioReviews` (in the bell) | 7 in series, ~310ms | 3 rounds, ~150ms | 5 nested relations, then the rules query waited for them |
| `loadCompanyFinancials` job read | 5 in series, ~480ms | 2 rounds, ~250ms | same shape |
| `loadRetainageHeld`, `loadFringeSchedulesByCraft`, `renewalSourcesForCompany`, the active-job read | 2x per render each | 1x | nothing deduped server reads within a render |

Each flattened read sends the SQL Prisma was already sending
(`WHERE "jobId" IN (...)`, the same ORDER BY for the two nested
`take: 1`s) and hands back the nested read's shape, so no arithmetic moved.
**Check: the JSON output of every layout and /pipeline loader was
byte-identical before and after (`cmp`).** The dedupe is React `cache()`,
which is per request: a Server Action's re-render still reads fresh data.

Layout plus page data, median of 15, A/B against `148e8b7` over three
alternating rounds: **~970ms → ~715ms**, 69 → 59 queries, and the slow tail
went from 1.1–2.3s to ~0.9s. The pool is now the ceiling: at
`connection_limit=10` the same A/B reads 798 → 570ms. That is an env
setting, raised with Diego rather than changed here. Prisma's
`relationJoins` preview feature would collapse every nested read in the app
into one query, but it is a generator change in the schema, so it was not
touched.

Tests: `group-rows.test.ts`, `pursuitListChanges.test.ts`,
`flattenedLoaders.test.ts`, and nine new cases in `bidPursuitList.test.ts`.
Eleven mutations were each run red and then restored: create not held,
no in-flight row, Add live before hydration, a held copy outliving a
refresh, newest-per-job keeping the last row, invoices filed under the wrong
group, crew member dropped, craft looked up by the wrong key, delete not
held, edit not held, and child queries sent for no jobs. The alert engine's
flattened read is also exercised on a real Postgres by
`alerts-query.dbtest.ts` in CI (retainage, closeout handover, certified
payroll).
