### The job page is eight routes now, not one 2,428-line scroll (Cyrus)
`cyrus/job-page-sections`

The founder's own words, walking the product with his engineer: "you have
to scroll down super far and then keep scrolling down... you should be
able to see everything without having to scroll. And then if you want to
go into a piece of it, then you just click into it." `jobs/[id]/page.tsx`
was the single worst instance of this in the app — one server component
rendering seventeen sections behind one `prisma.job.findUnique` that
fetched every relation on every load, whatever the viewer could see.

Applies the pattern PR #370 wrote down for exactly this
(`BidWizardSteps.tsx`'s own doc comment names the job page as next): real
URLs, never client accordion state. #370's shape was a linear STEPPER,
because bid creation is short and one-time; managing a job afterward is
open-ended and dipped into in any order, so this is TABS — same
load-bearing decision (a real route per section), different navigation
shape for a different kind of page.

**The shape.** A route group, `app/(app)/jobs/[id]/(tabs)/`, invisible in
the URL, so it does NOT wrap the three sibling routes that already had
their own single-purpose pages before this — `certified-payroll`,
`pay-applications/[invoiceId]`, `photo-report`. Its `layout.tsx` renders
an always-visible summary header (name, status, GC, and — withheld by
capability exactly as before — contract value, billed to date, retainage
held, crew size, dates) plus a tab rail, both fetched from one lean
`loadJobSummary` query. Eight tabs: **Overview** (`/jobs/[id]` itself —
details, status, schedule & crew, contract signature, subcontract),
**Estimate** (costing & WIP, line items or change orders), **Crew & time**,
**Compliance** (prevailing wage), **Billing** (invoices, pay apps),
**Retainage**, **Field reports**, **Photos**. Each does its own targeted
Prisma query — line items, cost entries and craft schedules on Estimate;
time entries and dispatch on Crew; nothing on Compliance beyond what it
prints — instead of the monolith's one query for everyone.

**Capability gates preserved exactly, not tightened.** Overview, Crew,
Compliance and Field Reports stay open, withholding a sub-section the same
way the monolith did (`showsJobManagement`/`showsField` flags, computed
from `lib/jobs/job-access.ts`'s `jobCapabilities` — one derivation now,
not copied per page). Photos hard-gates on MANAGE_FIELD
(`requireCapability`/`<NoAccess>`, same as `certified-payroll` already
does) because its job-media actions are independently guarded — proven by
`lib/action-capability-guards.test.ts`, which also found something real:
Estimate/Billing/Retainage's write actions (line items, cost entries,
change orders, invoices, retainage releases) are NOT independently
guarded on VIEW_JOB_COSTS/MANAGE_BILLING — only ever reachable from the
monolith's deliberately-open `/jobs/[id]`, so nothing ever required them
to self-guard. Hard-gating those three tabs would have CLAIMED a boundary
the action layer does not enforce, which is worse than no gate. So they
soft-withhold instead — identical security posture to before, not
loosened, not tightened — and the gap is reported as a GitHub issue for
Diego's lane (job costing/billing) rather than patched inside a layout PR.

**The walkthrough tour survives the split.** `jobDetailWalkthrough` (17
steps, one route) is now six walkthroughs, one per route that has
anchors — `job-detail.ts` (Overview), `job-detail-estimate.ts`,
`job-detail-crew.ts`, `job-detail-billing.ts`,
`job-detail-field-reports.ts`, `job-detail-photos.ts` — registered in
`lib/walkthroughs/index.ts`. `walkthroughCensus.test.ts`'s own anchor
census (171 tests) passed unmodified once every anchor found its new
route.

**Two censuses had a latent bug this surfaced rather than caused.**
`permissions.test.ts` and `action-capability-guards.test.ts` each
reconstructed a route's `page.tsx` path by string-concatenating the route
onto `APP_DIR` — which happened to work only because no route had ever
lived inside a NESTED route group (`(app)` at the top is the only one that
existed). `/jobs/[id]/(tabs)/estimate` is the first, and the
reconstruction silently pointed at a file that doesn't exist. Both now
record the real file path as they walk the filesystem, the same way
`lib/walkthroughs/census-helpers.ts` already did — fixed, not shimmed
around.

**Mutation-tested: 7 requested, 7 caught, all restored.** Tenant-isolation
check inverted (both `requireJob` and `requireJobGivenContext` callers,
4 assertions red); `jobCapabilities`' VIEW_JOB_COSTS/MANAGE_BILLING
mapping swapped (2 assertions red — the two whose expected values differ
between the swapped capabilities); Photos' `requireCapability` argument
changed to the wrong capability (`permissions.test.ts` named the exact
route); Photos' `<NoAccess capability>` prop mismatched from what it
enforces (same file's "explains a refusal with the same capability"
test, named); a walkthrough anchor deleted (`walkthroughCensus.test.ts`'s
orphan check named it); a `retainage-single-source.test.ts` allowlist
entry removed (named the missing file); the two censuses' path
reconstruction reverted to the naive form (reproduced the exact ENOENT
that motivated the fix).

**Not a data or money change.** No schema, no migration, no calculation
touched — every `money()`/`calculateJobWip`/`calculateRetainageSummary`
call is the same arithmetic over the same fields, just fetched by the
route that renders it instead of by one query for the whole page.

**Not clicked in a browser.** No session here can sign in through Clerk
against a real database. Full suite (336 files / 5501 tests, 22 new)
green, typecheck/lint/build/preflight green, no pending migration. The
click-list is in the PR.
