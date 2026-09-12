### The WIP schedule leaves the building — Sheet 15's last Missing row (Diego)
`claude/prova-vercel-direct-url-hg1acx`

A surety or a bonding company asks a sub for a WIP schedule once a quarter.
Prova computed every figure on one and could not produce the document:
`lib/wip.ts` has done percentage-of-completion by the cost-to-cost method
since the first week — its own header calls that "the standard approach
sureties and CPAs expect on a WIP schedule" — but it rendered one job at a
time on `/jobs/[id]`, and the question is about the whole book on one page.

`/api/wip-schedule`, linked from `/cash-flow`, is that page as a CSV. One
row per contracted or in-progress job, a totals line, and over- and
under-billings split into the two columns a balance sheet reads them as
rather than the one signed number `WipJobResult` carries.

**The columns were the easy part. The decision this is really about is what
the file refuses to say.**

This app already declines to state an earned-revenue or over/under-billing
figure for a job whose estimates are mostly missing — `jobEarnedRevenue` and
`jobOverUnderBilling` return null below 80% coverage and the job page renders
a dash. `jobOverUnderBilling`'s own comment says why in plain terms: below
that line, "Overbilled $80,000" is "an artefact of missing estimates rather
than a fact about the job".

An export that printed those numbers anyway would be **worse than the
screen**. A dash on a page invites a question; a number in a spreadsheet in
front of an underwriter does not, and it would carry this app's authority
into a document that decides a bond line. So the export goes through the
same accessors the screen does, a silenced figure is an **empty cell and
never a zero**, and the three coverage ratios ship as columns so a reader can
see why a cell is blank instead of wondering whether the export is broken.

The dollar sums are never silenced — only the derived positions. That is the
rule `calculateCompanyFinancials` already states: "The coverage question is
answered by silencing the RATE, never by quietly changing which jobs the sums
are over." Cost to date and billed to date are money that moved, and they are
true whether or not anyone estimated the job.

**Two findings came out of building it.**

`percentComplete` had no guarded accessor, so `MIN_COST_COVERAGE` and
`jobPercentComplete` are new — a third constant at the same value as the
other two, for the reason the second one already gives: the three ratios have
three different predicates, and one name would invite someone to answer all
three questions with one ratio. `costCoverage` is the only one weighted by
actual spend, so it is the only one that answers "was this percentage drawn
from most of the money". That, too, was already a sentence in `lib/wip.ts`
naming the reader it matters to — a job with $306k of spend whose percentage
comes from $96k of it "is not 30% complete in any sense a surety would
recognise". On a document leaving the building it had to become behaviour.

And **estimated gross profit was wrong in the first version, caught by
reading a sample file rather than by any test.** Contract value less the cost
forecast mixes a full contract against a partial cost: an $840k job with
$96k of forecast covering 22% of it read "Estimated gross profit 744,000",
which is not a forecast, it is the unestimated part of the job wearing one.
Now guarded on `estimatedCoverage` — the ratio `MIN_ESTIMATE_COVERAGE`
exists for, and deliberately not the earned one, since a line estimated at
zero cost is covered on the cost side and not the revenue side.

Nine mutations run. Exporting the raw earned revenue, the raw over/under
position, or the raw percentage are each caught; a zero written where a blank
belongs is caught; dropping a column from the list is caught by a structural
test comparing the column keys against a real row's keys; a totals line
printing an averaged percentage is caught; and removing the new gross-profit
guard is caught.

**One mutation survived the first attempt, and it is the useful one.**
Setting `MIN_COST_COVERAGE` to 0 left every coverage test green, because
every one of them built its fixture *from* the constant and so moved with it.
Same family as `dateRenderCensus`'s size cross-check and
`scratch-cleanup-order`'s 180-of-181: a check that derives its own input
cannot see its input change. The threshold is pinned to a literal now, with
the behaviour asserted at concrete coverages that name no constant at all.

Also in this PR, flagged rather than smuggled: two FEATURE-AUDIT rows
corrected against the code. Sheet 05 said there is no substantial-completion
date — `Job.substantialCompletionDate` has existed since the retainage work
and drives the release forecast. Sheet 23 said COI expiry alerting "doesn't
exist yet" while Sheet 26's own row, on the same page, described it working.
Both drifted in the same direction, understating what is built, which is how
work gets done twice.

Preflight: 125 files, 2181 tests, no migration.
