### Phase codes — what the same work costs across every job (Cyrus)
`cyrus/phase-codes`

A contractor's budget is written in their own cost codes — `04112` /
"Plywood - SF" — and until now this app had nowhere to put them. A
`JobLineItem`'s description is free text and belongs to one job, so "what
has plywood actually cost us this year" meant opening every job and
reading. `/phase-codes` answers it: budgeted against actual, per code,
summed across the whole book, with the variance and how many jobs each
code appears on.

**The part worth reading, because it is the part most reports get wrong.**
Most line items have no phase code and never will — there is no backfill,
deliberately, since inferring a phase from a description string is exactly
the guess the column exists to replace. A page that quietly summed only
the coded lines would show somebody a total that looks like their whole
budget and is not, and they would have no way to tell. So uncoded work
gets its own **"Not coded to a phase"** row with its own money — always
rendered, including at zero, because a row that vanishes when it is empty
is a row nobody can trust when it is not — and the page states, above the
table, what share of budgeted cost is coded, in the same shape `lib/wip.ts`
reports `costCoverage` for a job. Budget coverage and actual coverage are
answered separately, because a company can code its budget carefully and
still book spend against uncoded lines; one number pretending to answer
both would answer neither.

Retiring, not deleting. A phase code with priced work against it is the
evidence of how that work was coded on jobs that may already be invoiced,
and the foreign key is `ON DELETE SET NULL` — so a delete would not even
fail loudly, it would silently uncode every line the code was on. There is
no delete action in the module and a test asserts the module exports none.
A retired code stops being offered and keeps reporting its history;
bringing it back is one click, because nothing was destroyed.

**The checks.** The rollup is pure (`lib/phase-code-rollup.ts`) with the
row-reading split out (`lib/phase-code-rollup-query.ts`), the same split
`lib/alerts.ts`/`lib/alerts-query.ts` uses. 21 unit tests on the
arithmetic and 18 on the actions, every one mutation-tested — a phase on
two jobs summing across both, an uncoded line landing in the uncoded row
and in NO phase row, coverage falling and reading 100%, a retired phase
still reporting its history, and a duplicate code coming back as a
sentence both when the read-then-write check catches it and when the
database's unique index does. That second half is #224's scar: production
redacts a thrown Server Action message, so a raw P2002 reaches a user as a
dead button.

`/phase-codes` is gated on `VIEW_COMPANY_FINANCIALS`, like `/cash-flow` —
it is the whole book of cost, grouped by phase instead of by job, and
`lib/permissions.ts` withholds the whole book from a PM on exactly that
ground. Arguable, and the cost is named in the code: an estimator holds
`VIEW_JOB_COSTS` and not this, and cost history per phase is what pricing
the next job wants. Widening it later is one line; a page that has already
shown the whole book cannot be un-shown.

**Not finished, and this is the half somebody has to pick up.** Nothing
can be coded to a phase from the UI yet. Both line-item forms — the add
form and the inline row edit — live inside `app/(app)/jobs/[id]/page.tsx`,
and the two actions behind them are in `lib/actions/jobs.ts`; both are the
other lane. `components/PhaseCodeField.tsx` is the picker and the tag,
written and ready, rendered nowhere, with the three edits it needs written
at the top of the file. Until those land, `/phase-codes` will honestly
report every line as uncoded — which is the true state of the data, and
the page saying so rather than showing a confident empty table is the
whole point of it.
