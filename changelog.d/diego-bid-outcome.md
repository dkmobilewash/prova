### The app can finally tell you whether you bid a job right (Diego)
`diego/bid-outcome`

`estimating.prisma` has said for months that "linking a won `BidInvitation`
forward to its Job is a future refinement, not built here." That sentence was
load-bearing in the wrong direction: without the link there was no way to put
what a job was **bid** at beside what it actually **cost**, so the one number an
estimator most wants to learn from could not be computed at all.

Every feedback loop the app had was narrower. `catalog-actuals.ts` answers it
per catalog entry. `phase-code-rollup.ts` answers it per phase code.
`bid-pipeline.ts` answers win rate. None of them answers *did we bid this job
right.*

Now a won bid can be linked to the job it became, and `/bids` shows the
comparison.

**A verdict is only given on a FINISHED job, and that is the whole design.** A
job three weeks in has spent a fifth of its cost and earned none of its
lessons; reporting "you bid this 40% over" from that is worse than reporting
nothing, because it is a real-looking number that gets remembered and repeated.
So the comparison has three states and says which one it is in every time:
while the job runs, cost to date is reported **as** cost to date with the
percent complete beside it and the word *margin* never appears; once it is
complete, the variance is stated; and anything missing — no bid amount, no
costs, no forecast — is **named** rather than guessed. The numbers that would
be mistaken for a verdict are `null` on an unfinished job **by construction**,
not merely un-rendered, so a caller cannot print what does not exist.

**The company-level record counts only what has settled**, and says how many
bids it excluded. A rate computed over "every bid, treating the unfinished ones
as on-budget" would improve the more work was in progress — the same shape as
counting a dead verify agent as a refutation.

**Cost comes from `calculateJobWip`**, the same definition the WIP schedule and
the job costing panel already use — `calculateLineItemWip` per line, invoices
summed, `unassignedLaborCost` included. A private total here would have drifted
from them within a month with no way to tell which was right. The query shape is
duplicated from `loadWipSchedule` because that one filters to CONTRACTED and
IN_PROGRESS, precisely excluding the COMPLETE jobs a settled bid needs; the
arithmetic is not duplicated at all.

**Nothing links the two automatically, and that is deliberate.** Project names
rarely match the GC's wording, dates rarely line up, and one GC sends three
invitations for one building. A fuzzy match would attach a bid amount to the
wrong job's costs and then *teach the estimator from it* — the same posture
`JobLineItem.sourceCatalogEntryId` takes ("deliberately NOT backfilled by
fuzzy-matching descriptions"). A person picks it, from a picker that uses the
shared `jobPickerLabel` for issue #65's reason, which bites harder here than
anywhere else: every other picker's wrong answer is a misfiled record, and this
one's is a wrong lesson.

`wonJobId` is unique, so two bids cannot claim one job and leave "what was this
bid at" with two answers; the action names the bid already holding it rather
than letting a constraint error reach production, where the message is redacted.
SET NULL, so cleanup deleting a job does not take the bid history with it — the
bid is the record of what was quoted, and that stays true whatever happens to
the job.

Migration is additive: one nullable column, one unique index, one FK. No
backfill — there is nothing to backfill from, which is the point.

Two mutation tests, both caught: give a verdict on an unfinished job (6 red),
and average the unsettled ones in as zero (2 red).
