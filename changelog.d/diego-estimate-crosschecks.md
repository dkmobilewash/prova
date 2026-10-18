### "You measured it and never priced it" — the first cross-check in the app (Diego)
`diego/estimate-crosschecks`

The estimating audit's stage 5 asked for a scanner that catches *"you measured
50 doors, but have 0 hardware sets priced"*. A sweep of the whole estimate
surface found **twelve** advisory checks and **not one** of that shape. Every
existing check reads a SINGLE ROW — a line with a price and no cost, an
alternate with no amount, a run with no height — or a FIXED LIST
(`missingIndirects`: eight enum members with no triggering quantity). Those
catch a field somebody left blank. None can catch work that was measured, or a
price that was decided, and then never reached the number sent to a GC.

The only precedent was `lien-waiver.ts`'s `exceptions-short`, where retainage
plus submitted change orders are quantities held elsewhere that imply an amount,
and it warns when the typed figure falls short. This is that pattern pointed at
an estimate.

## The two rules, and why only two

**Traced and never posted.** Somebody calibrated a sheet, clicked along forty
walls, and the estimate has nothing from it. `TakeoffMeasurement.postedAt` is
the declared fact — the schema calls it *"an event, not derived state"* — so
this needs no interpretation of anything. It is the closest this product has to
the audit's own example, and it is literally "you measured N things and priced
none of them".

**Carried and not on the estimate.** `carriedAt` is the estimator's own
decision about which sub's price went into the bid, and a subcontract package is
usually the largest single line on a drywall bid. Carrying one and not posting
it is money missing from the number a GC was sent.

Only two, because these are the two where the implying quantity is DECLARED. A
third candidate — openings deducted from board area imply door and window work —
was dropped on the rule that governs this whole file: there is no declared
opening TYPE, only width and height, so naming what is missing would mean
reading line text. **It does not read descriptions looking for meaning.**
"Hardware" is not a concept this product has, and a check that grepped for
"door" would fire on "Door frame patching" and stay silent on "DR hdwe".
Classification here is declared, never guessed — the rule `costCategory`,
`craftClassificationId` and the takeoff recipes all keep.

## Present is two signals, which is the anti-cry-wolf half

A carried quote counts as posted if a line carries the exact description the app
would have written, **or** if a SUBCONTRACTOR line's budgeted cost equals the
quote to the cent. One signal alone would have been a cry-wolf generator: an
estimator who renamed the line keeps a correct estimate and would be told
forever that the quote was missing. The second costs nothing and is pure
declared data — a category and a number. A matching cost under another category
is deliberately NOT accepted, or the amount would be doing the categorising.

The expected description comes from `carriedLinePlan`, the same function
`addCarriedQuoteToEstimate` uses to write the line and to find its own
duplicate — so the comparison cannot drift from what the app would actually
write. A second copy of that format is the defect this repo keeps writing
censuses to catch.

## The database corrected the design, twice

**`BidInvitation.wonJobId` is UNIQUE.** The first fixture put three bids on one
job and Postgres refused it: `Unique constraint failed on the fields:
(wonJobId)`. That is a fact about the feature and not only the fixture — a job
reaches at most ONE bid, so every carried quote the panel can report comes from
that single bid, one per PACKAGE rather than one per bid. No comment anywhere
said so; the database did.

**`Company` does not cascade to `Contact`.** A bare `company.delete` in cleanup
failed on `Contact_companyId_fkey`. `takeoff-currency-query.dbtest.ts` had
already worked out the dependency order and it is reused rather than
rediscovered.

## Verification

- 17 unit tests on the pure module. **Mutation-proved in BOTH directions**,
  which is #616's rule for a warning: inverting `postedAt` reds 7 including the
  silence cases and the clean-estimate case; making the carried check always
  fire reds 5 including the anti-cry-wolf one.
- **8 tests against a real Postgres** (`estimate-crosschecks-query.dbtest.ts`),
  because both implying quantities live outside the job's own row and every one
  of those assertions is a wrong join away from being false: the NEWEST plan
  only, `postedAt` carried through, carried-and-priced-and-linked only, and
  three negatives — uncarried, unpriced, linked to no job.
- **The tenancy guard is mutation-proved too:** dropping `companyId` from the
  bid query reds both leak tests by name, `expected [ { vendorName: 'Their
  Sub', … } ] to deeply equal []`. There is a control on the control — the same
  rows read correctly when asked as their own company — because two "returns
  nothing" assertions would both pass on a query that always returns nothing.
- `typecheck`, `lint`, 570 files / 8,877 unit tests, and the 64-file/640-test db
  suite run locally.
- No schema, no migration, no new action, no model call.

## What it does not do

It never blocks and never concludes. There is no "estimate looks complete"
here, for `bid-responsiveness.ts`'s reason: it cannot see what is missing that
it has no rule for, so a reassurance would be a claim about work it never
examined. Amber rather than rose, beside `MissingIndirects`, because a
measurement that is not on the estimate is a question with two ordinary answers
— where a bid under its own cost is a fact.

And one bound that is real: `JobLineItem` has no `sourceBidQuoteId` — CLAUDE.md
lists that as deliberately deferred — so two carried quotes at the SAME amount,
one posted and one not, read as both posted. Narrow, and closing it is a schema
change rather than a cleverer comparison.
