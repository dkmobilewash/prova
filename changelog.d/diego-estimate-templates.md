### Estimate templates — the shape of a job you bid often, applied in one press (Diego)
`diego/estimate-templates`

A sub bidding tenant improvements bids the same twelve lines every time: track,
studs, board, tape, corner bead, finish, clean. `addLineItemFromCatalog` takes a
single `catalogEntryId`, so the twelfth bid of the month was typed exactly like
the first.

**The job turned out to be much smaller than the gap made it sound**, and that
was worth finding out before building. The *expansion engine* already exists
twice over — `WallType`/`WallTypeComponent` → `scheduleLines` → `wall-schedule.ts`
(priced, catalog-linked) and takeoff `RECIPES` → `createLineItemRows` (unpriced)
— and so does the bulk writer into `JobLineItem`. The only missing piece was the
**container**: a company-scoped, editable set of catalog pointers.

**This is not a second home for line-item data.** `ARCHITECTURE.md` opens with
the one non-negotiable rule in this codebase — *"there is exactly one place
line-item data lives… If you're about to add a table like `ContractLineItem`,
`BudgetLineItem`, or `EstimateItem` — stop."* An estimate template is precisely
that shape, so it is worth saying why this is not that table. `JobLineItem` is a
**job's** scope, read by every view. Nothing here is a job's anything: this is
company reference data that *generates* those rows, which the schema already
does twice (`LineItemCatalogEntry` calls itself "a template for that call";
`WallTypeComponent` is "one material or labor item in a wall type's assembly").
This is the third, modelled on the second down to `catalogEntryId` being
nullable and SET NULL, so re-pricing the catalog never reaches back into a line
already on somebody's estimate.

**There is deliberately no back-link from a template item to the lines it
generated**, and that is the one real difference from the wall schedule.
`WallTypeComponent` has one and *needs* it, because a wall schedule re-syncs:
change a run's length and `syncWallScheduleLines` finds its own lines and
updates them in place. A template is a **starting point**. Once applied, those
lines belong to the estimator, who will re-price them, split them, delete half
and add three more. A back-link would invite a "refresh from template" button,
and that button would silently overwrite exactly the work somebody came to the
estimate to do.

**Which means applying twice appends twice** — a real way to send a bid out
double. So `templateApplication` reports which lines the estimate already
carries **before anything is written**, and the screen shows it while there is
still a decision to make. Reported, never refused: a second floor's worth of the
same lines is legitimate, and a rule guessing which case this was would be wrong
half the time. A line the estimator **deleted** is ignored in that comparison — a
removed line is a decision, and warning about it would be arguing with it.

**A template item with no default quantity generates a line at 1, never 0.** A
line reading "1 SF" is obviously unfinished and gets fixed; "0 SF" prices to
nothing and makes a total look complete. 1 is also `JobLineItem.quantity`'s own
schema default, so this agrees with the database rather than inventing a second
rule.

Applied in **one transaction**: a half-applied template leaves six of twelve
lines and no way to tell which six are missing without reading the template
beside the estimate.

**Two things the guards caught, both worth recording.**

`action-capability-guards.test.ts` failed `applyTemplateToEstimate` by
*executing* it against an ACCOUNTING member: it asked for `MANAGE_ESTIMATING`
like every other action in that section, but it lives on the job's **estimate
tab**, which withholds on `VIEW_JOB_COSTS` — as does its sibling
`addLineItemFromCatalog` on the same screen. The stricter capability would have
handed a real person a page they can open and a button that refuses them. Every
other action in that section sits on `/catalog` or `/bids`, which is why the
habit was wrong here and only here.

And the dead-code census refused five actions as "exported but nothing calls
it" until the UI existed — doing exactly the job CLAUDE.md describes, on work in
progress rather than after the fact.

One small refactor rides along: `catalogLineFields` is extracted from
`addCatalogLine`, so the two writers of catalog-sourced lines share one mapping.
That file already carries the scar of the alternative — a comment recording a
fix that survived inside the bug it fixed, because a sentence claiming two
things agreed went stale instead of failing. `quantity` is deliberately left
out of the shared helper: it is the one field the two callers genuinely
disagree about.

Migration is additive: two tables, nothing dropped and no existing column
altered. Neither carries a `jobId`, so neither needs cleanup-script
registration; `EstimateTemplateItem` is scoped through its template, the same
call `WallTypeComponent` makes.
