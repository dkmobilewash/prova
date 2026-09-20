### What actually changed, in plain English (Cyrus)
`cyrus/payroll-in-job-cost`

Issue #287 said job cost, WIP and percent complete left out all payroll. It
was fixed on `main` two days ago by #296 — and left wrong in three more
places, which is why the issue was still open and worth re-opening the code
for rather than just closing the ticket.

The one that costs money is the catalog. `/catalog` shows "actual $X/unit
across N costed lines", and the button under it writes that number into the
catalog entry's default budgeted cost — the number that prices every future
bid and grounds every AI-drafted estimate. It was summing `CostEntry` rows
only. A `CostEntry` comes from one place in the product, the manual "log a
cost" form, so on a self-performed framing or drywall line it was the board
and the screws and none of the crew.

Two things follow, and the second is worse than the first. The derived unit
cost could only ever come out LOW, never high, so the errors reinforce rather
than cancel and each click walks the catalog nearer to materials-only — the
identical one-directional bias #105 finding 2 fixed for unfinished jobs. And
a line whose entire cost is logged hours has no `CostEntry` rows at all, so
`hasCosts: costEntries.length > 0` did not merely understate it, it dropped
it out of the sample entirely. The catalog learned nothing from exactly the
jobs it most needed to learn from.

`/phase-codes` is the reporting half of the same omission. `PhaseCode` has a
`tracksLabor` column, so a cost code explicitly flagged as tracking labor
reported spending nothing against its budget — and reported it as an
underrun.

Both now read hours through `lib/labor-job-cost.ts`, the same helper
`/jobs/[id]`, the WIP schedule and the WH-347 use, so a dollar of crew time
is the same dollar on every screen that reports it.

Hours that no `FringeRateSchedule` covers are the honest half. `labor-cost.ts`
deliberately refuses to guess a wage, and "we had no rate for it" reads
exactly like "it cost nothing" inside a total. So a catalog line carrying any
unpriced hours is excluded from the sample rather than averaged in
understated, and the re-price button refuses with that reason NAMED — the fix
is a wage schedule, not waiting for another job to finish. `/phase-codes`
shows unpriced hours per row and above the table.

The check that matters most is not any of the above. Every guard #287 left
behind named a FUNCTION, so each only covered a surface somebody had already
thought to route through it — which is precisely how a fix landed on seven
surfaces and missed three, for three unrelated reasons (a different field
name, a different aggregate, a different page). The new census rule is about
the QUERY instead: a file that asks the database for `CostEntry` rows is a
file computing what something cost, and it must ask for the hours too. That
catches the eleventh surface before anyone has decided which helper it should
use. It derives its file set and asserts the set's SIZE first, so a pattern
that matches nothing fails loudly instead of certifying an empty question.

`ARCHITECTURE.md` said "Actual is SUM(costEntries.amount)" for months after
that stopped being true. Corrected here rather than in a docs-only PR,
because the code it describes is in this change.

**Added after Diego's review, and the review question was the better one.**
He accepted that the ledger double-count is correct on /jobs/[id] and asked a
narrower question: should a line carrying BOTH priced hours and a
LABOR-category cost entry count at face value in what the CATALOG *learns*?

No — it is excluded, with its own named count, and here is the argument. The
ledger rule exists because nothing can tell a duplicate from two real costs,
and refusing to show money somebody logged would be worse. That reasoning is
about DISPLAY. The catalog is not a display; it is a sample the app learns a
rate from and then writes into the number that prices the next bid. The
question stops being "is this money real?" and becomes "is this line legible
as a unit cost?" — and a line where the same labor may appear twice is not.

Which makes it the third member of a family this file already had, not a new
rule: an unfinished job's cost is real but is not a unit cost; unpriced hours
are real hours but are not dollars; ambiguous labor is real money that is not
a legible rate. All three are now excluded and NAMED on screen.

The asymmetry that settles it is the direction of the error. Exclusion is
visible and recoverable — the badge says why, and recategorising the entry
fixes it. A doubled figure banked into the catalog is silent, compounds on
every reprice, and biases bids HIGH, which is the opposite direction from the
#287 bug this branch shipped with. Losing money on work you won at least shows
up in job costing; losing work you never won leaves no trace at all, so nobody
goes looking for a cause.

Deliberately narrow: neither half alone triggers it. A contractor who tracks
labor purely as cost entries is perfectly legible, and so is one who only logs
hours. And the predicate is written in DOLLARS (`laborCost > 0`), not hours —
a mutation swapping it to `laborHours > 0` survived the first battery, and the
case that kills it is a per-diem-only day: a TimeEntry with no hours still
carries allowance money, so a line can hold labor dollars and zero labor hours.

The stale-doc half of the review generalised too. Diego caught
`packages/db/prisma/schema/jobs.prisma` still carrying the sentence corrected
in ARCHITECTURE.md. Grepping for it found a THIRD copy at ARCHITECTURE.md:81,
which nobody had named. All three now say the same true thing.

26 mutations run in the first pass, 26 verdicts returned. 23 were caught first time; **3
survived, and they were the most useful result of the exercise.** Two were
one bug in my own census — it looked for the string `TIME_ENTRY_COST_SELECT`
anywhere in a file, and deleting the `timeEntries:` line from a query leaves
that symbol sitting in the file's import, so the guard went on certifying a
query that had stopped fetching hours. Exactly the shape CLAUDE.md warns
about: the check was not lying, it was answering a question nobody asked. The
third was a test that could not tell a correct exclusion count from one that
double-counts, because the single case it used gave both the same answer. All
three guards were fixed and all three mutations re-run red.

NOT VERIFIED, and it is the gap that matters: nothing here was clicked against
a database with real hours on it. There is no Postgres in this session, so the
dbtest suite is unrun on my side — CI runs it. The click-list in the PR is
what still has to be done by hand.

A further 14 mutations for the review round, 14 verdicts returned, 13 caught.
The one that survived (N10) was an invalid mutation rather than a gap: it
deleted the census assertion under test, which no test can catch by
construction. The real coverage for that rule is the production-code pair —
removing `category: true` from the page's query and from the write action's —
and both were caught.
