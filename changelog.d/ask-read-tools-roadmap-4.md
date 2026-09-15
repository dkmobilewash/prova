### The Ask box answers five more questions — cash flow, retainage, change orders, labor cost and the OSHA log (Diego)
`claude/prova-ai-task-completion-96pjes`

Five read tools, taking the registry from ten to fifteen. Each one answers
a question a contractor asks out loud and the box could only shrug at:
*what's coming in next month*, *how much retainage is being held on us*,
*which change orders has the GC not come back on*, *what has labour cost
us on Riverside*, *how many recordable injuries this year*.

Every figure is computed by the library the corresponding page already
uses — `calculateCashFlowForecast`, `calculateRetainageSummary`,
`changeOrderValueDelta`, `calculateTimeEntryLaborCost`, `isRecordable` —
so an answer and the screen it came from cannot disagree. That is the
rule this registry was built on, and it is why none of these needed new
arithmetic.

**Three of the five carry a number that would be a lie on its own, and
the work was making each say so.**

`job_labor_cost` never reports money without the share of hours it was
drawn from. `calculateTimeEntryLaborCost` returns null for an entry whose
craft has no rate schedule covering its date — it refuses to guess a rate
— so on a half-configured company the total is real and partial at once.
A job where nothing could be priced returns null rather than zero, because
"we cannot price these hours" and "these hours cost nothing" are different
answers and only one is true.

`change_order_status` reports how many proposals it could NOT book beside
the value. A pending REMOVE against scope an earlier approved change order
already deleted is worth zero — `approveChangeOrder` would refuse it — so
the change order's value silently shrinks and nothing in the number says a
row was dropped (#105 finding 5). And the days figure is elapsed time, not
lateness: nothing records an agreed response time for a change order the
way an RFI carries a contractual response date, so the tool must not imply
one. It uses `daysBetween` rather than `daysPastDueFor` for that reason
alone — identical arithmetic, and the second name would plant "overdue"
in the one place it must not appear.

`cash_flow_forecast` reports retainage with no substantial completion date
as its own unscheduled total. It is real money owed with no basis for
when, and putting it in a month — including the overdue one — would be a
forecast nobody made.

**`retainage_held` takes its company figure from one place and its rows
from another, on purpose.** The total is `loadRetainageHeld`, the single
source issue #97 exists to enforce, which counts EVERY job because
retainage comes back at closeout and a status filter drops exactly the
completed jobs whose money is still owed. The per-job rows are built the
way /cash-flow builds its table, because a scalar cannot carry job names.
The two agree by construction — no per-job clamp, so a sum of differences
is the difference of sums — and the total is read from the loader anyway,
so that if a clamp is ever introduced they disagree visibly instead of one
quietly becoming the other. The test makes the loader disagree with the
rows deliberately, which is the only way to prove which one is being read.

**What is NOT here, and why.** The roadmap listed six, and company-wide
over/under billing is the one missing. `job_margin` already returns
over/under billing per job; what is genuinely absent is the ROLL-UP, and
that belongs to `wipScheduleTotals` on the open WIP-schedule PR. Writing a
second summation of the same figure here is the "two surfaces computing
the same number separately" bug this codebase has shipped twice and which
`lib/ask/handlers.ts`'s own header names. It waits for that PR.

**A correction made while writing it, worth more than the feature.** The
change-order handler carried a comment claiming its unfiltered line-item
read prevented under-reported exposure — that a target map missing a
soft-deleted row would price a proposal at zero. Wrong: `proposalIsBookable`
treats an absent target and a deleted one identically, so filtering would
change no figure today. The read stays unfiltered because that is the shape
`changeOrderValueDelta` documents and because the distinction is real to
that predicate, and the comment now says exactly that instead of a more
dramatic thing that was not true.

**A test-infrastructure fix that came with it.** Six handler test files
mocked `@prova/db` by naming one export, which held only while nothing
`handlers.ts` imports used another. `lib/change-order.ts` builds a
`new Prisma.Decimal(0)` at module scope, so the moment a handler imported
it every test in those files failed at IMPORT time with an error about the
mock rather than the code. They now partial-mock through `importOriginal`,
keeping the real `Prisma` namespace and its real Decimal arithmetic — which
also caught a fixture of mine passing plain numbers where the database
returns Decimals.

Two mutations run by hand, both caught: deriving the company retainage
total from the rows (#97's own shape), and counting unpriced hours as
priced.

Verified: typecheck, lint, 162 unit files / 2,719 tests, the database
suite against a real Postgres 16 at 80 migrations, changelog check and a
production build. Nine eval cases added, one per tool plus the filters.
Nobody has clicked it; the click list is in the PR.
