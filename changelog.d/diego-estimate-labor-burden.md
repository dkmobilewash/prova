### The screen said "≈ $5,600 labor" and the bid carried $0 (Diego)
`diego/estimate-labor-burden`

Two defects in the same place, found by the 2026-10-04 audit of the estimating
workflow against source.

**A labor line could contribute nothing to the bid while the screen priced it.**
A line with 80 hours of Local 300 journeyman, coded LABOR and with no
`budgetedUnitCost`, is left out of the recap's cost base entirely and marked up
at nothing — correct, documented, and silent. The hint beside the hours field
printed "≈ $5,600 labor" next to it. Both numbers were right and the screen was
a lie by omission.

It now says **"not in the bid"** when the line carries no cost, in amber, and
there is a **Use this as the cost** button beside it that writes the per-unit
figure. That button is not a backfill and not automatic: four places in this
repo argue against auto-filling a cost and all four are right —
`setLineBudgetedCost`'s *"One number at a time, each one the estimator's own"*,
`bid-recap.ts`'s *"deliberately not softened by a backfill"*, the schema's
*"never filled in from `unitPrice` … No backfill was ever run"*. A press is a
different thing, and `applyBidRecap` is the standing precedent for one: *"a
decision with a date on it, not a side effect."*

**It refuses a line that is not coded LABOR, and that refusal is the feature.**
A `JobLineItem` carries one `costCategory` and one `budgetedUnitCost` — there is
no labor/material split on a line anywhere in the schema. On a "hang and finish
5,000 SF" line coded MATERIAL, writing the labor cost would not add to the board
cost, it would delete it. The refusal says so and says to split the line.

**The second defect was quieter and is the one that moved every job's numbers.**
The estimate priced labor at wage + CBA fringes; the job costing it is later
compared against adds employer FICA, FUTA/SUTA and workers' comp on top. Same
hours, two bases — so every job showed a labor overrun of roughly the burden
percentage, systematically, and because percent complete is cost-to-cost the
completion figure drifted with it. `estimate-labor-cost.ts`'s own header says it
reuses the actuals functions precisely so a variance is never *"partly an
artefact of the arithmetic"*, and then the burden sat one layer above in a path
the estimate does not go through. Nothing in the code ever argued for that; it
was structural, not chosen.

The estimate now prices labor the way the job costs it. **The percentage
multiplies the base wage only, never the fringes** — `employer-burden.ts` states
that as a modelling choice for a CPA to confirm, and the estimate asks the same
question of the same base-wage function rather than inventing a second rule. The
burden is resolved at the job's **labor rate date**, not today, because the
fringes already price at that day and a figure whose two halves answered as of
different days is one nobody can reconcile.

**With no `EmployerBurdenRate` recorded, nothing moves.** That is the guarantee
the change rests on and the opt-out for a shop that carries burden inside its
overhead percentage instead — don't record a rate and nothing is counted twice.
It is proved rather than asserted: every pre-existing case in
`estimate-labor-cost.test.ts` passes `null` and still expects the figure it
expected before the parameter existed, and the parameter is REQUIRED rather than
defaulted so a new caller has to decide instead of silently inheriting "no
burden".

**It does not round, where the actuals path does**, and that is deliberate rather
than a second rule: `labor-job-cost.ts` accumulates across many `TimeEntry` rows
and rounds once because it posts a ledger figure; this is one line, linear in
hours, and rounds exactly once — when the per-unit cost is written to
`Decimal(12,2)`. Rounding earlier would also break the property the live preview
depends on, that rate × hours is the line's own figure to nine decimal places.

**The screen stopped over-claiming too.** The hint hardcoded *"Burdened labor:
base wage plus fringes"* — using the word "burdened", which to a contractor means
fully loaded, for a figure with no employer taxes in it. That is the exact
over-claim Cyrus removed from the job-cost side; the sentence is generated from
`laborCostBasisLabel` now and cannot drift from the arithmetic again.

**Two censuses caught this branch and both were right.** `hoursRenderCensus`
found a bare `{decision.hours}` that would have reached a screen as
`35.300000000000004`; `action-capability-guards` flagged the new action as
unguarded, which was a false positive worth reading — its `bodyOfAction` takes
the first `{` after the function name, and on a multi-line signature returning
`ActionResultWith<{ … }>` that is the inline object in the RETURN TYPE, so it
never saw the guard. It fails loudly rather than quietly, which is the safe
direction, and the fix here was a named return type rather than a change to the
census.

Also added `fringeScheduleInput` to `labor-cost.ts`: there were already six
hand-written copies of that Decimal→number mapping and this action was about to
be the seventh. Only the two files this change already touched were migrated onto
it; the other five are a follow-up rather than a silent rewrite of code this PR
has no reason to be in.

563 test files, 8,759 unit tests, and the 63-file/632-test db suite run locally
against a throwaway Postgres — the gate `pnpm test` does not cover and that caught
two stale fixtures on #609.
