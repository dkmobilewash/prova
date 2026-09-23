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

---

### The wiring, and a CLAUDE.md bullet that failed the build

The branch above shipped a phase-code model, a management page and a
cross-job rollup, and **nothing could be coded to a phase from the UI** —
both line-item forms and both write actions are in the other lane. That is
the exact "built, and the last wire missing" shape a product review had just
spent a day diagnosing, so it is closed here rather than left as an issue.

`phaseCodeIdFromForm` in `lib/actions/shared.ts`, sitting directly beside
`craftClassificationIdFromForm` and deliberately the same shape: the id
arrives from a `<select>` in a browser, so it is a claim, and it is looked up
through the caller's own `companyId` in the same `where` clause. Without it a
caller could post any company's phase code id and have it stored on their own
line item, where it would read back as a code they do not have and land in a
budget report grouped by it. `craftClassificationIdFromForm` has no test at
all; this is the first of the pair to get one, and it asserts the argument
sent to the database rather than a returned value — a seeded test would pass
equally against a post-query ownership check, which is the same protection
with one more place to forget it.

**A retired code is accepted on purpose and there is a test saying so.** It
is not OFFERED by the picker, but a line already coded to one must survive
being edited for any other reason: a retired code is evidence of how work on
an invoiced job was coded, and dropping it on save would rewrite that
quietly. The test asserts the `where` carries no `isActive`, so the tidy-up
that would erase it fails.

`apps/web/app/(app)/jobs/[id]/page.tsx` belongs to the other lane and got
**17 inserted lines and no restructuring** — an import, the destructure, a
six-line query, and the picker in each of the two forms. No section slot was
touched. `PhaseCodeField` grew a `labelled` prop rather than a second
component, because the add form stacks labelled fields and the inline row
edit is a row of bare controls leaning on `title` — the craft select beside
it has no visible label either. One component, so the option list, the
retired-code rule and the "Not coded to a phase" wording cannot drift apart.

**No phase tag on the read-only row, and that is a decision.** The craft is
not shown there either, so a phase badge would have been the only such
marker on the row and inconsistent with its own neighbour.

**And a correction to CLAUDE.md, which is why this rides along with code.**
Its "List pages" bullet said owner-only destructive actions use
`assertOwner(context, "…")`. `assertOwner` THROWS, and production redacts a
thrown Server Action message — so an action declaring `Promise<ActionResult>`
that refuses that way renders as a dead button, and
`ownerRefusalCensus.test.ts` fails the build on it. The correct helper is
`ownerRefusal`. The bullet has been corrected, with the distinction stated:
`ownerRefusal` for anything returning `ActionResult`, `assertOwner` only in
the older throw-style actions. Found by a branch doing exactly what the
bullet told it to.

Mutations on the new helper, each watched red: company scope dropped from the
`where`; `isActive: true` added to it.

test 3240/3240 (190 files), lint clean, typecheck clean, build green.
