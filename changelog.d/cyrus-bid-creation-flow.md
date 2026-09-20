### Starting a bid is now a three-step wizard instead of one long scroll (Cyrus)
`cyrus/bid-creation-flow`

The founder's own words after walking the product: "when you're going to
start a bid, it seems like everything is stacked on top of each other...
you should be able to see everything without having to scroll." Before
this, `/jobs/new` collected a job name and GC on one short screen and then
`createJob` redirected straight into `/jobs/[id]` — the full job
management page — which is where the actual "wall of fields" lived:
takeoff, line items, catalog pricing, all appended sections from past
feature PRs.

CREATING a bid and MANAGING one are different shapes, and this splits
them. `/jobs/new` is step 1 (job name, scope, GC — unchanged). `createJob`
now redirects to `/jobs/new/[jobId]/items`, step 2, where three ways to
add work — type a line by hand, pull one from the catalog, or run a
takeoff (`<TakeoffForm>`, reused unchanged) — sit above a running list of
what's on the estimate, with a running dollar total. Step 3,
`/jobs/new/[jobId]/review`, is a summary with a "Finish" link into
`/jobs/[id]` for everything else: pricing detail, craft/phase tagging,
contracting. `<BidWizardSteps>` is the progress header on all three, and
its own doc comment states the pattern for whoever applies this to the
job page next.

**Not a data-model change.** Same `Job`/`JobLineItem` fields, same
`createJob`/`addLineItem`/`addLineItemFromCatalog`/`addTakeoffLineItems`/
`deleteLineItem` actions — the wizard is a new arrangement of existing
actions and existing components (`TakeoffForm`, `ConfirmDeleteButton`),
not new ones. No schema, no migration.

**A half-finished bid is never client state to lose.** Each step is a
real URL, and the job row exists in the database the instant step 1
submits — `hasLeftWizard`/`bidWizardTotal` (`lib/bid-wizard.ts`) are the
only new pure logic, and a refresh or a bookmark on any step just
re-renders the job as it currently stands, or hands off to `/jobs/[id]`
if the job has moved past ESTIMATE since. The two new forms on step 2
follow the house onSubmit + preventDefault + `new FormData` pattern
(`formActionCensus.test.ts`), so a refused save — bad quantity, a stage
guard — leaves every typed field on screen next to the reason, never a
`form.reset()` on the failure branch.

**Checked:** `lib/permissions.test.ts`'s route-decision census extended
for the two new dynamic routes (both `OPEN_ROUTES`, same reasoning as
`/jobs/new` and `/jobs/[id]` beside them — money withheld in-page behind
`VIEW_JOB_COSTS`, same as `jobs/[id]`'s own estimate section). Full
`apps/web` suite green (323 files / 5236 tests, 20 of them new), typecheck,
lint, build, `./scripts/preflight.sh` — no migration. Four mutations, four
caught: `bidWizardTotal`'s multiply→add (2/2 assertions in
`bid-wizard.test.ts` went red), `hasLeftWizard`'s `!==`→`===` (3/3 went
red), the manual-add form resetting on its catch branch too (killed by
name in `bidWizardLineItems.test.ts`), and a `<form action={fn}>`
reintroduced on that same form (caught by name and line by
`formActionCensus.test.ts`). Removing the two new `OPEN_ROUTES` entries
was also confirmed to fail `permissions.test.ts` by route name before
being restored.

**Not clicked in a browser** — no session here can sign in through Clerk
against a real database, and the task said not to point this branch at
one. The PR carries a numbered click-list.
