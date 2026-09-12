### The WIP schedule a surety actually asks for, as a file (Diego)
`claude/prova-contractor-os-e3f0iz`

Bonding capacity turns on a work-in-progress schedule, and until now every
figure on one existed in this app and none of them could leave it. The
`/jobs/[id]` percent-complete tile even carries a comment saying it "is what
a surety's WIP schedule gets typed from" — typed, by hand, one job at a
time, into a spreadsheet nobody could check. That is now one download:
`/cash-flow` renders the schedule and `/api/export/wip-schedule` hands it
over as CSV.

**Not one number in it is new, and that is the design rather than a
shortcut.** `lib/wip-schedule.ts` composes `calculateJobWip`,
`jobEarnedRevenue`, `jobOverUnderBilling`, `jobCostVariance` and
`changeOrderValueDelta`; it derives nothing itself. A WIP schedule whose
percent complete disagrees with the percent complete on the job page is
worse than no schedule, because the disagreement is found by the underwriter
instead of by us — and this repo has already paid for two company-wide
figures that meant different things.

**Original contract value is arithmetic, not a stored column.** Once a job
leaves ESTIMATE, `assertEditableDirectly` refuses every direct edit to a
line's quantity or price, so an approved change order is the only thing that
can move contract value after that point: original = revised − approved.
That identity has exactly one hole and it is detectable rather than silent —
a change order approved before `ChangeOrderProposal` gained its `previous*`
snapshot columns has no record of what it replaced, so its EDIT and REMOVE
proposals are valued at zero and the subtraction would overstate the
original by an unknown amount. The query counts those proposals and the
schedule blanks BOTH halves of the split when there are any. A WIP schedule
with a plausible invented number in it is worse than one with an honest gap.

**Every blank is a sentence, never a zero.** Earned revenue and the
over/under-billing pair are withheld below `MIN_EARNED_COVERAGE` and the
forecast margin below `MIN_ESTIMATE_COVERAGE` — the same thresholds and the
same refusals the job page and `jobHealthSentence` already make, imported
rather than restated. The Notes column says which threshold was missed and
what was therefore withheld, and the total row says how many jobs a total
dropped rather than presenting a floor as a total.

One row does not add up on purpose, and says so with the dollar figure:
cost-to-complete is summed from the lines rather than taken as (cost at
completion − cost to date), because on a job with spend on lines nobody has
re-forecast those two differ and the subtraction goes NEGATIVE. That gap is
issue #100's shape — `calculateJobWip` deliberately keeps unforecast spend
out of both sides of the ratio — so the schedule names the amount instead of
hiding it.

**The gate is a decision, not a default.** `/api/export` is OWNER-only
because one file holding every job, every price and every employee's hours
is a different object from any page. This is not that object, and it asks
for `VIEW_COMPANY_FINANCIALS` **and** `VIEW_JOB_COSTS` instead — both,
because the file genuinely contains both kinds of fact. The case that
decided it: ACCOUNTING holds both, and an owner-only gate would have locked
out the one job function that exists to produce this document, on a page it
can already open. It sits under `/api/export/` so `middleware.ts` already
protects it; no shared file was touched.

**What proves it.** 40 unit tests over the pure module, and six mutants
killed rather than assumed: swapping the over/under-billing sign convention,
dropping the earned-coverage refusal, deriving cost-to-complete by
subtraction, removing the split refusal, emptying the column list, and
dropping every job row. The last two are the vacuity direction — an
iteration over an empty set passes every assertion inside it, so the column
count is pinned against a hand-edited literal and the row count against the
input array's length. Both went red exactly where they should.

`FEATURE-AUDIT.md` Sheet 15 goes to 6 built / 0 partial / 0 missing: the WIP
export row and the job-profitability row both close, the second as columns
OF this report rather than a second document that would re-derive the same
margin and become the number that disagrees.

**The same edit corrects a count claim that has been false on `main` since
#233.** That PR added "Re-derived 2026-09-10 by summing all 26 per-sheet
headers: 99 + 19 + 6 + 1 = 125, agreeing with the prose line and the summary
table." It was never run: at `4c8fe18`, the commit before it, the bold line
already read 126 / 100 and the headers already summed to 126. So the
sentence contradicted the line twelve lines above it and read as the more
trustworthy of the two precisely because it showed its working. A claim to
have re-derived something is harder to doubt than a bare number and is not
itself a derivation.
