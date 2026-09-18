### Logged hours finally reach job cost — issue #287 (Cyrus)
`cyrus/labor-in-job-cost`

On a self-performed framing or drywall job, labor is most of the cost. This
app has computed each logged day's BURDENED wage — base plus pension,
vacation, health & welfare and training, at the fringe schedule effective
for that craft on that date — since `lib/labor-cost.ts` was written, and
`/jobs/[id]` printed it beside the time-entry row. It then added it to
nothing.

`actualCostToDate` was fed only by `CostEntry` rows, and a `CostEntry` comes
from exactly one place in the product: the manual "log a cost" form. So
percent complete, earned revenue, over/under billing, gross margin, the
company metric bar and the WIP schedule a bonding company reads were all
computed over roughly a third of the money — and nothing on any screen said
so. The comment beside the percent-complete tile says that tile is what a
surety's WIP schedule gets typed from.

**Nothing is stored.** No `CostEntry` is materialised from a `TimeEntry`:
derived state is never stored here, and materialising it would also
double-count against a manual "labor" cost somebody has already typed. It is
computed at read time by one function, `lineItemCostToDate` in
`lib/labor-job-cost.ts`, which reuses `findEffectiveFringeRateSchedule` and
`calculateTimeEntryLaborCost` exactly as `lib/certified-payroll.ts` does —
so a dollar on the job page and a dollar on a WH-347 come from the same
arithmetic rather than a second costing rule.

**THE BRIEF SAID THREE CALL SITES. THERE WERE SEVEN.** `/jobs/[id]`,
`company-financials-query.ts` and `wip-schedule-query.ts` were the three
named; `alerts-query.ts` (the over-budget alert), `today-dashboard.ts` (job
health), `ask/handlers.ts` (the `job_margin` tool) and
`actions/billing.ts` (`generateJobWipNarrative`) were doing the same sum
and were not. Fixing three would have been worse than fixing none in one
specific way: two screens would then report different costs for the same
job, which is this repo's two-meanings-of-"the database" scar wearing new
clothes. All seven now go through the one helper, and
`lib/jobCostCensus.test.ts` DERIVES the set of `calculateLineItemWip`
callers rather than listing it — because a hand-written roll-call is wrong
the day somebody adds the eighth — and fails if any of them builds its cost
without labor. It asserts the size of the set it found first, so a scan that
matches nothing fails loudly instead of certifying an empty question.

**THE BRIEF ALSO ASSUMED LABOR HANGS OFF A LINE ITEM. MOST OF IT DOES NOT.**
`TimeEntry.lineItemId` is nullable and the log-hours form's cost-code select
defaults to "No specific line", so unattached entries are the ordinary shape
of a logged hour. Costing only the attached ones would have left most of a
job's labor out while every screen looked fixed. Unattached labor goes into
the JOB's `actualCostToDate` and into no line's — passed to `calculateJobWip`
as its own argument rather than as a synthetic $0-value line, which would
have landed in contract value and in the forecast filter and reproduced
issue #100's 550%. It therefore correctly pulls `costCoverage` down, which
the job page already prints: the percentage genuinely was not computed over
that money.

**Unpriced hours are NAMED, not silently zero.** `calculateTimeEntryLaborCost`
returns nothing when an entry has no craft tag or no fringe schedule covers
its date — it refuses to guess, deliberately, because a wrong burden gets
bid. Those hours contribute no wage dollars, and "refused to guess" reads
exactly like "cost nothing" unless a screen says which. So `WipJobResult`
carries `unpricedLaborHours`, `pricedLaborHours` and `laborHourCoverage`;
`/jobs/[id]` prints "12 of 920 logged hours have no craft tag or no effective
fringe rate schedule, so they are in this figure at $0 of wages (99% of hours
priced)" under **Actual cost to date**; and the WIP CSV ships two new
columns, **Burdened labor in cost to date** and **Unpriced labor hours (in
cost at $0)**. The coverage figure is an HOURS ratio, not a dollar one, on
purpose: the dollars on the unpriced side are precisely what nobody can
compute, so a dollar share would have to invent the number it is warning
about. Zero unpriced hours prints as `0` rather than blank — unlike the
silenced money cells, "every hour is priced" is a fact this schedule knows.

**PER DIEM AND TRAVEL PAY ARE IN, AND FLIPPING THEM OUT IS ONE LINE.**
`TimeEntry.perDiemAmount` and `.travelPayAmount` are flat stored dollars
that need no rate, and they are real money the company pays to have the work
done, so they count today. Because that is a judgment call the founder is
still making rather than a fact about accounting, it is
`LABOR_ALLOWANCES_IN_JOB_COST` in `lib/labor-job-cost.ts` — set it to
`false` and allowances stop reaching `actualCostToDate` on all seven
surfaces at once. They are still counted and still reported separately as
`laborAllowanceCost` either way, so nothing goes dark; the number just stops
being added in. `wageCost` and `allowanceCost` are never summed into one
opaque figure. The constant is typed `boolean` rather than left to literal
inference so the other branch stays compiled.

**The specific checks.** 18 mutations, every one confirmed RED and restored:
wages never accumulating; unpriced hours counted as priced; allowances folded
into wages; labor SUBSTITUTING manual cost entries instead of adding to them;
the line-item filter dropped; the unassigned filter inverted; hours lost in
the Decimal conversion; the allowance flip turned off; unassigned labor
dropped from job cost; labour coverage hardcoded to 1; a line's labor
discarded by `calculateLineItemWip`; `laborCostToDate` counting wages only;
unpriced hours zeroed on the CSV row and on its TOTAL line; `today-dashboard`
and `wip-schedule-query` reverted to the cost-entries-only sum; the jobs page
dropping unattached hours; and the census pointed at a directory that does
not exist, which must fail rather than certify nothing.

**What is NOT verified, said plainly.** The four database query files and
the job page are covered by unit tests of the arithmetic and by a SOURCE
SCAN that they call it. Nothing here loaded a page against a database with
real hours on it — that is the click-through, and it is the only thing that
proves the number on the tile moved.
