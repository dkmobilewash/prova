# Architecture

## The problem this exists to fix

Every competing contractor CRM treats "the estimate," "the contract,"
"the budget," and "job costing" as separate documents. A contractor builds
an estimate, then retypes it into a contract at signing, retypes it again
into a budget tool, and retypes change orders a third time — then
reconciles all of it by hand against what the job actually cost. That
manual re-entry is the single biggest source of error, wasted time, and
mistrust in this workflow, and it is the reason this product exists.

**The non-negotiable rule: there is exactly one place line-item data
lives.** Not "the estimate data gets copied into the contract at signing."
Not "the budget is generated from the estimate." One table, read by every
view.

If you're about to add a table like `ContractLineItem`, `BudgetLineItem`,
or `EstimateItem` — stop. That's the exact anti-pattern this document
exists to prevent. Extend `JobLineItem` instead, or add a column, or ask
why the existing shape doesn't fit.

## The data model

```
Company
  └── User (linked to Clerk via clerkId)
  └── Contact
  └── Job
        ├── Contact (the client)
        ├── JobLineItem[]        ← the unified object
        └── ChangeOrder[]
                ├── addedLineItems: JobLineItem[]   (new scope)
                └── edits: ChangeOrderLineItemEdit[] (audit log of in-place edits)
```

### `Job`

A Job represents one project for one client. Its `status` field
(`ESTIMATE → CONTRACTED → IN_PROGRESS → COMPLETE`) does not gate which
table `lineItems` come from — the same rows back the job at every stage.
What it does gate (enforced server-side in `apps/web/lib/actions/*.ts`,
not just hidden in the UI) is *how* those rows may be changed:

> **Path corrected 2026-09-02, in three places in this file.** There is no
> `apps/web/lib/actions.ts` and there has not been for weeks — it was split
> by domain into `apps/web/lib/actions/*.ts` (37 files) behind a barrel at
> `lib/actions/index.ts`, and `packages/db/prisma/schema.prisma` was split
> the same way into `packages/db/prisma/schema/*.prisma`. Both names still
> appear throughout this document and throughout WORK-SPLIT.md. WORK-SPLIT
> at least carries a note saying so; this file carried none, so it read as
> current. A path that does not exist sends an agent grepping for a file
> instead of a symbol — grep for the function name, which is stable across
> the split. The estimate-stage gate itself is `assertEditableDirectly`,
> `lib/actions/shared.ts:47`.

- **`ESTIMATE`** — line items can be added, edited, and removed directly.
  Nothing to audit yet; it's still a draft.
- **`CONTRACTED` or later** — direct edits are rejected. Any change to
  scope or pricing must go through a `ChangeOrder`, which is what makes
  the audit trail in `ChangeOrderLineItemEdit` meaningful: it only exists
  for changes made *after* the client agreed to something.

This is the piece that makes "change order" a real concept rather than
just an alternate way to edit the same table at any time.

### `JobLineItem` — the unified object

A single `JobLineItem` row is simultaneously:

- **An estimate line** — what the contractor proposed.
- **A contract line** — what the client is agreeing to (the `/jobs/[id]`
  page renders these rows directly as the contract-style summary).
- **A budget line** — `SUM(quantity * unitPrice)` across a job's
  non-deleted line items is the budget, always, at any point in the job's
  life.
- **A job-costing line** — actual cost vs. estimated cost is tracked via
  `CostEntry` rows that reference a `JobLineItem` (one per real expense —
  a receipt, a labor entry), the same way `ChangeOrder` references it.
  Actual cost is `SUM(costEntries.amount)`, computed, never stored as a
  duplicate field on the line item. A single `actualCost` column was
  considered and rejected: it can't tell you *what* it's made of, and a
  contractor needs the breakdown (materials vs. labor vs. subcontractor),
  not just a number.

There is no transformation step where an "estimate" becomes a "contract"
or a "budget." They were never different things.

`isDeleted` is a soft delete. When a change order removes scope, the row
is flagged rather than destroyed, so the job's history stays intact and
nothing that was once billed disappears from the audit trail.

`laborHours`/`craftClassificationId` are the same idea applied to labor:
optional fields on the one row, not a parallel labor-estimate table.
`craftClassificationId` points at the global `CraftClassification`
reference table (journeyman/apprentice/foreman, per union local), scoped
at the application layer to locals this company actually has a
`CompanyUnionAgreement` with — `CraftClassification` itself carries no
`companyId`, so that join is the access check.

### `LineItemCatalogEntry` — a template for the same `jobLineItem.create` call

A reusable line item, scoped to the company rather than any one job.
"Add from catalog" on an ESTIMATE-stage job creates an ordinary
`JobLineItem` pre-filled from the entry's defaults — the same create call
`addLineItem` uses, just with different inputs. There's no second live
copy of estimate data anywhere: a catalog entry is a starting point, not
a linked record a `JobLineItem` stays in sync with afterward. Entries are
meant to accumulate from real, already-priced work ("save as catalog
item" on an existing line) rather than requiring separate manual data
entry up front.

### `EstimateVersion` — a manual snapshot, not an edit log

`EstimateVersion.snapshot` is a plain JSON copy of a job's line items at
the moment "save version" is clicked — the same pattern as
`SignatureRequest.snapshot`. This answers "what did we price this at
before the scope changed" directly, without a parallel line-item history
table that would need to stay in sync with every `JobLineItem` edit ever
made. It's a checkpoint the PM chooses to save, not an automatic audit
trail of every keystroke — only available pre-award, same
`assertEditableDirectly` gate as every other direct estimate edit.

### `BidInvitation` as the historical bid database

`BidInvitation` (see the GC-relationship-management section above)
carries `tradeScope` and `bidAmount` for exactly this reason: "what have
we bid on similar EIFS work before, and at what price" is a filter over
this one table — `/bids` — not a separate historical-bids table to keep
in sync with it.

### `ChangeOrder` — mutates the same rows, never forks them

A change order does exactly one of three things, and all three operate on
`JobLineItem` directly:

1. **Adds new scope** → a new `JobLineItem` row is inserted with
   `originChangeOrderId` pointing at the change order. It is not a
   different kind of row — it's a `JobLineItem` like any other, so it
   immediately counts toward the budget total, appears in the contract
   summary, and (in later phases) job costing.

2. **Modifies existing scope** (a price change, a quantity change, a
   description correction) → the existing `JobLineItem` row is updated
   **in place**. The old and new values are written to
   `ChangeOrderLineItemEdit` — but that table is an audit log only.
   Nothing computes a total, renders a summary, or drives any business
   logic from it. If you deleted every row in
   `ChangeOrderLineItemEdit`, the budget and contract summary would be
   unaffected; you'd only lose the "why did this change" history.

3. **Removes scope** → the existing `JobLineItem` row is soft-deleted
   (`isDeleted = true`) in place, logged the same way as a modification
   (`field: "deleted"`). Same reasoning as above: no fork, no second
   table, just a flag on the row that already existed.

**This is how a change order updates the budget without re-entry:** the
budget was never a separate number to begin with. It's
`SUM(job.lineItems WHERE isDeleted = false)`. A change order changes that
sum by writing to the exact rows that sum reads from. There is no sync
step, no second write, no reconciliation job.

### Why not version/snapshot the whole line-item set per change order?

An earlier, more "complete-looking" design considered snapshotting the
full line-item set at every change order (so you could show "here's
exactly what the contract said before CO #2"). That was deliberately cut
from Phase 00 — it's a compliance/audit concern, not a foundation
concern, and building it before a real e-sign/compliance flow defined
what "the signed version" actually needs to capture would have meant
guessing at a shape.

That e-sign phase has since landed (see `SignatureRequest` below), and it
resolved the question narrower than the original framing: a snapshot is
taken **once, at contract signing** — not at every change order. A signed
change order's own approval flow doesn't exist yet (see below), so there's
still no per-CO snapshot. The `ChangeOrderLineItemEdit` log remains the
answer to "what changed and when" for everything after signing.

### `SignatureRequest` — the client's e-signature, and where snapshotting actually landed

A `SignatureRequest` is a token-based, unguessable link (`/esign/[token]`)
the contractor generates and sends to the client out of band — there's no
client login (that's the separate, not-yet-built client-portal phase), so
the token stands in for one. While pending, the link renders the **live**
contract via the same `ContractSummary` component `/jobs/[id]` uses — one
rendering path, so the client never sees something different from what the
contractor sees.

The moment the client signs, `signRequest` writes a `snapshot` (JSON) of
the line items, total, and scope **as they were at that exact instant**,
alongside `signerName`, `ipAddress`, `userAgent`, and `signedAt`. This is
the snapshot the earlier design considered and Phase 00 deferred — it
exists now because there's finally a real reason to freeze a point in
time: proving what was legally agreed to. It follows the same rule as
`ChangeOrderLineItemEdit`: **audit-only**. No live view — not the contract
summary, not the budget — ever reads from it. If a change order later
edits a line item that was part of the signed snapshot, the snapshot does
not change; `/esign/[token]` renders from it directly once signed, so a
client revisiting their signed link always sees exactly what they agreed
to, even if the job has moved on since.

`markJobContracted` now requires a `SIGNED` `SignatureRequest` to exist
before a job can leave `ESTIMATE` — the "contracted" status is meant to
represent a legally agreed contract, not just an internal decision, so
the gate enforces that rather than just labeling it.

### `ChangeOrderStatus` / `ChangeOrderProposal` — the pending/approved lifecycle

That "natural next increment" has landed. `ChangeOrder` now carries a
status: `DRAFT` → `SUBMITTED` → `APPROVED` or `REJECTED`, with `VOID` for
one we withdrew before the GC answered.

The rule that makes it safe is that **nothing before `APPROVED` touches
`JobLineItem`**. A pending change order's content lives in
`ChangeOrderProposal` — a description, a quantity, a price, and which line
item it targets — and `approveChangeOrder` is the only thing that turns
those rows into real scope.

That constraint isn't stylistic. Contract value, WIP, retainage and pay
applications are all ultimately `SUM(job.lineItems WHERE isDeleted =
false)`, and that filter is hand-written at ten separate call sites. If a
pending change order wrote to `JobLineItem`, every one of those figures
would silently include money the GC hasn't agreed to pay, and closing the
hole would mean finding and correcting all ten — plus every one added
afterwards. Keeping proposals out of `JobLineItem` entirely means none of
those call sites need to know this lifecycle exists.

`ChangeOrderProposal` is deliberately **not** the same table as
`ChangeOrderLineItemEdit`. The edit log is an after-the-fact record of what
a change order did (old → new), and it stays audit-only per the rule above.
A proposal is a before-the-fact statement of what it *would* do. Collapsing
them would make the audit log load-bearing, which is exactly what the
`ChangeOrderLineItemEdit` section above rules out.

`approveChangeOrder` applies every proposal inside one transaction and sets
`appliedAt`. A partially applied change order would leave the contract
value at a number neither party agreed to, so a single bad proposal — a
line another CO already removed, say — aborts the whole approval and leaves
the status at `SUBMITTED`. `appliedAt` is also what stops the same change
order reaching the budget twice.

Dates are entered rather than stamped, same rule as RFIs and submittals: a
PCO logged after the fact has to record the date it actually went out, or
the turnaround evidence a delay claim rests on is fiction.

### Correcting an approved change order

An approved change order has already moved the contract value, so "just edit
it" is not available in general — a pay application may already have been
drawn against that value, and changing it underneath one makes the two
disagree with no visible reason. There are two exits instead, and which one
applies is decided by what already references the scope:

**Reopen** (`reopenChangeOrder`) takes it back to `DRAFT` and undoes its
effect, so it can be corrected and re-approved. Allowed only while its scope
is untouched. What counts as "touched" depends on what the reversal does to
the row:

- `ADD` is reversed by **deleting** the line item it created, so anything
  hanging off that row blocks it: costs, hours, pay-application lines, and
  any other change order whose proposal targets it (that FK is `ON DELETE SET
  NULL`, so deleting the row would quietly empty out someone else's pending
  change order).
- `EDIT` is reversed by restoring the old quantity and price. Costs and hours
  survive untouched and do not block. Billing does.
- `REMOVE` is reversed by un-deleting the line, which is purely additive, so
  nothing blocks it.

Restoring those old values needs to know what was overwritten, and reading
that from `ChangeOrderLineItemEdit` would make the audit log load-bearing —
deleting a log row would change the contract value, which is exactly what the
audit-only rule above exists to prevent. So `approveChangeOrder` writes the
replaced values onto the proposal itself (`previousQuantity`,
`previousUnitPrice`, `previousIsDeleted`) as it applies them. A snapshot of
what was overwritten is a different thing from a log of what happened.

**Revise** (`reviseChangeOrder`) is the exit once reopening is blocked. It
raises a new change order carrying `supersedesId` back to the one it
corrects. The original stays `APPROVED` — it was approved, and it did move
the contract value; rewriting history to say otherwise would put the job out
of step with the pay applications drawn from it. A revision holds ordinary
proposals against the job's *current* state rather than a delta against the
original, so there is one set of apply mechanics rather than a second,
subtly different one.

Change orders approved before this existed carry no snapshot and so cannot be
reopened; the UI shows that as a blocker and offers a revision instead.

**Still not built**: a GC-facing review surface. Approval is recorded by
the contractor from what the GC told them, not captured from the GC
directly — there's no signature flow for change orders, only for the
initial contract. Extending `SignatureRequest` to a change order is the
natural next increment now that there's a pending state for it to attach
to.

### Migrations are applied by CI on merge, and only there

There are THREE Neon projects, and only one of them is production.
Diego's (`ep-little-sea-a6bdnaw2`) is what Vercel uses for PRODUCTION
ONLY, and it holds the real data. The demo project (`ep-patient-lake`) is
what every Vercel PREVIEW reads and writes. Cyrus's
(`ep-icy-hat-afqau56u`) is a dev database reached only from his laptop.
This document asserted a single database for weeks; that sentence is what
made a day of confusion possible, because "the database" meant two
different things to two people reading the same logs.

Corrected 2026-09-02, and note the shape of the correction: the paragraph
above went from one project to two and stopped there. The demo project was
added on 1 Sep (`344e152`), CLAUDE.md's table was updated, and this
paragraph was not — so for a day this document told you a preview writes
the real data and CLAUDE.md told you it does not, which is the same
"the database means two things" failure the paragraph is about, one level
up. A count that has already been wrong once is not a fact to copy
forward; check the table in CLAUDE.md, which is the one that gets
maintained. Evidence for three: `migrate-demo.yml` and `seed-demo.yml`
exist and take `DEMO_DATABASE_URL`/`DEMO_DIRECT_URL`, and the preview arm
of `app/(app)/error.tsx` tells a broken preview to run the demo migrate
workflow — advice that only makes sense if previews read the demo
database.

Every Vercel build — preview or production — runs the same build command.
When that command applied migrations, every push to every branch changed
production's schema: `add_submittals`, `add_change_order_lifecycle` and
`add_change_order_reopen_and_revision` all reached production from preview
builds of branches whose PRs had not merged.

Gating that to `VERCEL_ENV=production` fixed the preview case and missed a
second door entirely. Promoting a preview to production reuses the
preview's already-built output, so the build command never re-runs and its
migrations never apply — a deployment can become production carrying code
whose schema changes never happened anywhere.

So migrations left the build entirely. `.github/workflows/migrate.yml`
applies them on push to `main` — tied to the merge, which is the actual
decision to change production, rather than to whichever build artifact
happens to become production. It applies, then reads `migrate status` back
to verify rather than trusting its own success message, because
"successfully applied" is precisely the claim that turned out not to be a
result.

What runs in the Vercel build now is `packages/db/scripts/check-schema.mjs`,
which applies nothing. It prints the host and database it is talking to on
every build — the thing whose absence made the two-project confusion
possible — refuses to build if `DATABASE_URL` and `DIRECT_URL` resolve to
different databases, and refuses a PRODUCTION build when migrations are
pending, since that means shipping code that reads columns which do not
exist. A preview only warns: a branch's own migration legitimately has not
merged yet.

**`ALLOW_EMPTY_DATABASE` DOES NOT EXIST.** Struck 2026-09-02: this
paragraph claimed "the applier also refuses a database with no migration
history unless `ALLOW_EMPTY_DATABASE=true`", and there is no such
variable anywhere in the repository — not in `migrate-deploy.mjs`, not in
`check-schema.mjs`, not in a workflow, not in `.env.example`. Nothing
reads it and nothing refuses an empty database. The claim was a described
guard that was never written, the same failure mode as the 90-second
migration wait in CLAUDE.md, and more dangerous than a missing guard on
its own because it invites someone to point a URL somewhere and trust the
net to catch them.

The risk it described is real and unmitigated. `prisma migrate deploy`
CREATES a database that does not exist and applies every migration to it,
reporting success — so a wrong URL does not fail, it manufactures a
second, empty, plausible database while the real data sits elsewhere.
Which is one candidate explanation for how this project came to have
more than one.

What DOES guard against this is `wrongTarget()` in
`packages/db/scripts/connection-target.mjs`: you name the endpoint you
mean, and it is compared against the host the connection string actually
resolves to before anything is applied. It is opt-in via
`MIGRATE_EXPECT_HOST`, and only `migrate-demo.yml` sets it. **Production's
`migrate.yml` does not**, deliberately (`migrate-deploy.mjs:70` — "so
production's job, which predates it, is unaffected until someone wires it
up deliberately"). So the demo database is protected from a wrong secret
and production is not. That is backwards, it is known, and nobody has
wired it up.

**The cost is real.** A preview of a branch that adds a model runs against
a database without those tables, so pages using them fail until the branch
merges — in a project whose first rule is to verify by clicking, that
matters. To verify such a branch before merging, apply its migration to the
target database yourself and redeploy; it is a deliberate act rather than
something a push does on its own.

**This is not the destination.** The actual fix is a database branch per
preview — Neon supports it natively through the Vercel integration — which
would give previews a real schema to test against without touching
production at all. This gate stops the bleeding until that is wired up.

Half-arrived 2026-09-01. The demo project moved previews off production,
so the paragraph above no longer describes previews writing real data —
that part is done. What it does NOT do is give a preview the schema its
own branch needs: one shared demo database serves every preview at once,
gets nothing on merge, and drifts the moment anyone adds a migration, so
"column does not exist" on a preview is still the normal failure and
still reads as a code bug. The remedy is a person clicking **Migrate demo
database** from that branch. A branch per preview would make that step
disappear; until then this is one step short of the destination, not at
it.

### `CostEntry` — actual cost, referencing the same line item

Job costing follows the identical pattern as change orders: a new table
that references `JobLineItem` rather than a new copy of line-item data.
Each `CostEntry` is one real expense (a receipt, a labor entry) tied to
the line item it was spent against. "Actual" is `SUM(costEntries.amount)`
for that line item — always computed at read time, never stored. "Estimated"
used to mean `quantity * unitPrice` (the sale price); since the WIP fields
below landed, it means the cost side instead — see `lib/wip.ts`.

Unlike change orders, logging a cost is **not** gated by `Job.status`.
The ESTIMATE/CONTRACTED gate exists to protect the client-facing
agreement — scope and pricing shouldn't silently change after signing.
Actual spending is a different kind of fact: it's internal, it happens
throughout the job (often *because* work is in progress), and gating it
would just make the numbers less accurate for no protective benefit.

### WIP (percentage-of-completion) — `JobLineItem`'s cost side, and `lib/wip.ts`

`unitPrice` is the sale price — what the client is billed. It was never
enough, on its own, to know whether a job is actually profitable at any
given moment: that requires a *cost* side too, and a way to say "budgeted
X, but we're now forecasting Y." Three fields on `JobLineItem` carry that,
deliberately kept separate rather than collapsed into one:

- **`budgetedUnitCost`** — set once, at estimate approval. The frozen
  historical baseline. Never silently overwritten by re-forecasting.
- **`currentEstimatedUnitCost`** — the PM's live forecast, defaulting to
  `budgetedUnitCost` at creation but independently mutable afterward via
  `updateLineItemForecast` (not gated by `Job.status`, same reasoning as
  `CostEntry` above — re-forecasting is internal, ongoing, not a change to
  what the client agreed to).
- **`estimatedCostToComplete`** — a nullable PM override. When null, cost-
  to-complete is derived mechanically as
  `(currentEstimatedUnitCost * quantity) - actual costs to date`. When
  set, it overrides that mechanical number, because the mechanical number
  is a floor, not the answer — a PM who knows a sub is behind schedule or
  a change order is coming can say so before the cost data reflects it.

`unitPrice` is also now nullable, for **cost-only budget lines** (general
conditions, overhead, contingency) that have no client-facing sale price.
Every place that sums `quantity * unitPrice` for a contract/invoice total
treats a null `unitPrice` as $0 revenue — the line still carries quantity
and cost fields, it just isn't billed directly.

`lib/wip.ts` holds the actual math — the cost-to-cost method, the standard
approach for a WIP schedule:

```
% complete   = actual costs to date ÷ estimated total cost at completion
earned rev.  = % complete × contract value (Σ quantity × unitPrice)
over/under   = billed to date − earned revenue
  (positive = overbilled/liability, negative = underbilled/asset)
```

Deliberately pure, deterministic arithmetic — not an LLM call. Financial
figures on a WIP schedule have to be exactly reproducible. Change orders
already write into `JobLineItem` directly (new rows via
`originChangeOrderId`, edits in place), so this math needs no special
handling for them — it just aggregates whatever line items exist on the
job at any point, the same way the budget total always has.

### The AI narrative layer — interpretation only, never the math

`generateJobWipNarrative` (in `actions.ts`) recomputes the exact same
`lib/wip.ts` figures the page itself displays, then hands only those
already-computed numbers to Claude (`generateWipNarrative` in
`packages/integrations/src/anthropic.ts`) for a short plain-language
interpretation — flagging what's overbilled/underbilled or which line
item's cost forecast has drifted from budget. The system prompt is
explicit that every number it receives is final: Claude is never asked to
recompute, restate as a different value, or "correct" a figure, only to
explain what the given numbers mean. This is the boundary the whole WIP
feature is built around — deterministic code owns every number that
appears on screen; the model only ever narrates numbers it was handed.

On-demand only, via a button (`WipNarrativeButton`) that calls the server
action directly and shows the result inline — the same "no `<form
action>`, call it from a client component" pattern `testQuickBooksConnection`
uses. Nothing is persisted: there's no schema field to cache a narrative
in yet, so every click regenerates fresh rather than reading a stale one.
Requires a real `ANTHROPIC_API_KEY` in the environment — same "provided by
the user, loaded from an env var, never hardcoded" rule as the QuickBooks
client secret.

### Company profile and multi-jurisdiction licensing

`Company` gained profile fields (`dbaName`, `ein`, HQ address, `phone`,
`website`) — all optional, since existing companies predate them and
there's no backfill source.

`CompanyLicense` is one row **per license held, not per state** —
licensing structure genuinely isn't uniform across jurisdictions:
California and Arizona classify by trade (`C-9`, `R-10/C-10/CR-10`, …),
Utah combines several trades into one code (`S270`), and Colorado has no
state contractor license at all — only municipal ones, so a company
working in Denver and Longmont holds two separate `CompanyLicense` rows
under `jurisdictionType: CITY`, not one "Colorado" row. That's why
`classificationCode`/`classificationLabel` are free text rather than a
hardcoded enum: a fixed list would only be correct for the states that
actually have one.

`LicenseClassificationReference` is a **global lookup, not scoped to a
Company** — the same CA/AZ/UT codes apply to every company licensed
there, so it's seeded once, not per-tenant. It's only seeded for
jurisdictions with a real, verified, fixed classification system.
**Nevada is deliberately unseeded**: NAC 624's exact subclassification
wasn't available from a public source at build time, and a wrong guess
there is worse than an empty table — `CompanyLicense.classificationCode`
just stays free text for Nevada (and for Colorado's municipal licenses,
which never had a fixed list to begin with) until someone does the real
lookup.

Whether a license is expiring/expired is computed at read time from
`expirationDate`, never stored — same rule as `ComplianceDocument`.
**Explicitly not built yet**: any actual alert/notification delivery —
there's no notification mechanism anywhere in this app. This is the data
an alert view would query, not the alert itself.

### `TradeScope` — a flat trade-family tag, not a hierarchy

`JobLineItem.tradeScope` and `CostEntry.tradeScope` (independent of each
other — a general-conditions line's cost entries can span more than one
trade) tag rows with one of five trade families. This schema's ICP is a
union wall-and-ceiling specialty subcontractor self-performing a narrow
set of trades with its own crews — not a diversified GC coordinating many
subs — so this is deliberately a flat categorization dimension on top of
the cost/WIP fields, not a self-performed-vs-subcontracted model and not
full CSI MasterFormat coding. Both are nullable: tagging is optional, not
a prerequisite for WIP reporting to work.

`CompanyTradeScope` — which trade scopes a company actually holds —
reuses this same enum rather than a parallel reference table (one
`companyId, tradeScope` join row, not a second "list of five trades" that
could drift from the first). `@@unique([companyId, tradeScope])` keeps a
company from getting duplicate rows for the same trade. `activeSince` is
nullable because a company can add a trade scope later as it grows,
rather than every company holding all five from day one.

### Union affiliation — CBAs, craft classifications, and effective-dated fringe rates

Five models, structured around one hard requirement: **certified payroll
and fringe reporting on an older job have to use the wage rate that was
in effect at the time, not today's rate.** A flat "current rate" field
would quietly corrupt historical job costing the first time a CBA rate
changed mid-project.

- `UnionLocal` — a global reference table (not scoped to a Company; the
  same local applies to every company that works under it). Deliberately
  **not seeded** — no verified source for real local numbers, and a wrong
  entry would misattribute a company's CBA to the wrong local.
- `CompanyUnionAgreement` — one CBA between a Company and a `UnionLocal`.
  `complianceDocumentId` links to the actual agreement document via the
  existing `ComplianceDocument` table (new `UNION_AGREEMENT` type) rather
  than a separate, disconnected file reference — the same document
  gets tracked one way, whether it's a lien waiver or a CBA.
- `CraftClassification` — tied to a specific `UnionLocal`, not a shared
  list, because classification names and progression steps (journeyman,
  apprentice period 1–5, foreman) aren't standardized across locals.
- `FringeRateSchedule` — **effective-dated**
  (`effectiveFrom`/`effectiveTo`, null `effectiveTo` = currently in
  effect), tied to a `CraftClassification`. `baseWage` plus four named
  fringe components (pension, vacation, health & welfare, training) as
  explicit `Decimal` columns rather than a JSON blob — these four are
  standard across CBAs in this trade, and typed columns are easier to sum
  and report on than a flexible blob would be.
- `ApprenticeRatioRule` — captures the ratio itself (e.g. 1 apprentice per
  3 journeymen). This bullet used to say the daily compliance check could
  not be built without a labor/time-entry data model. `TimeEntry` landed
  and `CraftClassification.tier` supplied the rest, so **the check now
  exists** — see the union fringe and apprenticeship section below.

**Non-overlapping `FringeRateSchedule` ranges are enforced at the
database level**, not just assumed correct by the application:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "FringeRateSchedule" ADD CONSTRAINT "FringeRateSchedule_no_overlapping_rates"
EXCLUDE USING gist (
  "craftClassificationId" WITH =,
  tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp)) WITH &&
);
```

This is a genuine exception to how every other constraint in this schema
gets expressed: `schema.prisma`'s DSL has no declarative way to describe
a Postgres exclusion constraint, so it's hand-written raw SQL in the
migration rather than generated from the Prisma model. Prisma Client
doesn't "know" about it either — a violation surfaces as a raw
Postgres error (verified: `P2010`, message containing "exclusion"), not
a typed Prisma error, so whatever create/edit action eventually gets
built for this table needs to specifically catch and translate it.
`btree_gist` is a standard Postgres contrib extension (bundled with
Postgres itself, supported on Neon) — required for a GiST index to
compare the plain-text `craftClassificationId` column for equality
alongside the date-range overlap check.

### Insurance and bonding — the company's own source records

`CompanyInsurancePolicy` and `CompanyBond` are the company's own
insurance/bonding data — distinct from `ComplianceDocument`, which tracks
documents flowing between this company and GCs/subs on a per-job basis.
This is the source data those per-job COIs would eventually get generated
from (future phase, not built here).

`coverageLimits` is free text, not structured limit fields: what
"coverage limits" means genuinely varies by policy type (general
liability: per-occurrence + aggregate; auto: combined single limit;
workers' comp: statutory + employer's liability) — a fixed set of columns
would be wrong for at least one type, the same reasoning as
`CompanyLicense.classificationCode` staying free text for jurisdictions
without a fixed classification system.

`CompanyBond` is **deliberately not linked** to
`CompanyLicense.bondNumber` (the bond-number field on a license, for
jurisdictions that tie a bond to the license itself). The two can
describe the same real-world bond without a forced foreign key between
them — connecting them explicitly is a future refinement, not guessed at
here.

Same pattern as licensing: `expirationDate`/`renewalDate` computed at
read time, no stored status, no actual alert/notification delivery built.

### `CompanyLocation` and `Job.operatingLocationId`

A physical office/yard/warehouse. `state` is broken out from the address
specifically because it's what would eventually let the app auto-derive
which `CompanyLicense`/`CompanyUnionAgreement` applies to a `Job` based on
which location is running it, rather than relying on someone to manually
pick the right one every time — but **that derivation logic isn't built**.
`Job.operatingLocationId` is just a place to record which location is
running the job; nothing reads it yet. `name` is a small addition beyond
what was asked for: a friendly label ("Denver Yard") so a location picker
doesn't have to show raw addresses.

The foreign key is `ON DELETE SET NULL` — deleting a `CompanyLocation`
un-assigns any jobs pointing at it rather than failing or cascading the
delete, verified against real Postgres.

### `Invoice` / `Payment` — billing, same pattern again

A third instance of the "reference, don't duplicate" rule. `Invoice`
references `Job` (not a copy of its line items — an invoice is a billing
event, a request for money, independent of which specific line items it
covers). `Payment` references `Invoice`, one row per real payment
received, supporting partial/progress payments. Amount paid and balance
are always `SUM(payments.amount)` vs. the invoice amount — computed, never
stored, exactly like actual cost on `JobLineItem`.

### `ComplianceDocument` — one table for four document types

Lien waivers, certificates of insurance, certified payroll reports, and
union fringe/benefit filings all share the same shape: a document tied to
a party (subcontractor, vendor, or union trust fund), often a specific
job, with a lifecycle (`PENDING` → `RECEIVED`) and, for COIs, an
expiration to track renewal. One table, one `type` enum, rather than four
near-identical tables — the same reasoning as `CostCategory` on
`CostEntry`.

`partyName` is free text, not a foreign key to a new Subcontractor/Vendor
directory model — building that directory is a separate modeling decision
this phase didn't need to make. `jobId` is nullable: a lien waiver or
certified payroll report is job-specific, but a general-liability COI
often covers the whole company, not one job.

Whether a document is "expired" or "expiring soon" is **computed at read
time** from `expiresAt`, never stored as a status — the same rule as every
computed total elsewhere in this schema (actual cost, invoice balance,
WIP percent-complete). A stored `EXPIRED` status would just go stale the
moment the clock passed the date; `status` only tracks the lifecycle step
that isn't derivable from dates alone (has the document been received at
all).

**AI extraction and file storage** (`/compliance`): uploading a document
stores the original file in Vercel Blob (`fileUrl`/`fileName`) and, in
parallel, sends it to Claude via `extractComplianceDocument` (see
`packages/integrations/src/anthropic.ts`), which reads `type`, `partyName`,
`amount`, and the dates into a forced tool call — never free-text JSON, so
there's no ambiguity in parsing what Claude returned. The result is saved
as a normal `ComplianceDocument` row with `aiExtracted: true`; that flag is
a "please verify" signal for the UI, not a lock — a wrong extraction is
fixed the same way a typo would be, not through some separate correction
flow. Upload isn't owner-gated (any team member can log paperwork they
receive from a sub), matching `addCostEntry`'s reasoning.

`Payment` is a manual record, not a charge — there's no payment
processor wired up (see Future phases). Invoicing is only available once
a job is `CONTRACTED` or later, for the same reason change orders are
gated: you don't bill for scope nobody has agreed to yet.

### Client portal — the `SignatureRequest` token pattern, generalized

`Contact.portalToken` is the same idea as `SignatureRequest.token`,
applied to standing access instead of a one-time signature: an
unguessable link stands in for a client login that doesn't exist yet
(that's still a separate, bigger decision — see Future phases if it ever
needs to become a real Clerk-backed account). Generated on demand from
`/contacts/[id]`, null until then.

The portal pages (`/portal/[token]` and `/portal/[token]/jobs/[jobId]`)
read the exact same `Job`/`JobLineItem`/`Invoice` data every other view
reads — the job list-page even renders through the same
`ContractSummary` component `/jobs/[id]` and `/esign/[token]` use.
Nothing is duplicated for the client's benefit. What's deliberately
excluded is job costing: actual cost and variance are internal margin
data, not something a client should see, so the portal never queries
`CostEntry` at all.

### GC relationship fields, bid invitations, and payment reliability

`Contact` also carries this GC's standing terms —
`defaultRetainagePercent`, `paymentTermsDays`, `standardFormsUsed` — as a
starting point to reference when scoping a new job with them, not a
value enforced anywhere yet. Actual per-job retainage withheld/released
tracking is a separate, bigger feature this phase doesn't build (see
Future phases).

`BidInvitation` tracks a GC inviting this company to bid, independent of
`Job`: most invitations are declined or lost and never become one. When
a bid is won, the PM creates the `Job` normally through the existing
estimate flow — linking a won `BidInvitation` forward to its `Job` is a
future refinement, not built here.

Payment reliability (`lib/gc-reliability.ts`) is computed at read time
from that GC's existing `Invoice`/`Payment` records — invoiced total,
outstanding, on-time rate, average days to pay — never stored on
`Contact`. Same rule as `lib/wip.ts`: a number like this has to be
exactly reproducible from source data, not cached and left to go stale.

### Contact create/delete, prospect status, account type, MSA/prequalification

Every existing `Contact` was created as a side effect of opening a job with
them — there was no way to enter a GC you're only talking to, and no way
to remove one added by mistake. `createContact`/`deleteContact`
(`lib/actions/company.ts`) close that. Deletion refuses once a `Job` or
`BidInvitation` references the contact — same reasoning as
`deleteSubmittal` refusing to delete a sent package: there's real
correspondence on record, and deleting the contact would strand it.

`ContactStatus` (PROSPECT/ACTIVE/INACTIVE) answers "are we engaging with
this account at all," independent of the read-only pipeline-stage view a
later phase derives from `Job`/`BidInvitation`/`EstimateVersion` state
("how far along is their most advanced opportunity"). Existing rows
backfill to `ACTIVE` — not a guess, since every one of them already has a
`Job`. `createContact` defaults a new row to `PROSPECT` instead: a
contact created this way has no history by definition.

`ContactType` (GENERAL_CONTRACTOR/DEVELOPER/VENDOR/SUBCONTRACTOR) is
nullable with **no backfill** — nobody has classified any existing
`Contact`, and defaulting them all to GC would be wrong the moment an
existing row turns out to be a developer, the same reasoning
`User.jobFunction` and `CraftClassification.tier` already use.

`msaExpirationDate`/`prequalificationExpiresAt` are both nullable dates,
null meaning "none on file" rather than a separate boolean — whether one
is active, expiring, or lapsed is derived at read time through
`lib/compliance-expiry.ts`'s existing `RenewalKind`/`classifyRenewal`
machinery (two new kinds, `MSA` and `PREQUALIFICATION`, added to that
shared type), not a second copy of the day-counting arithmetic that shared
module exists specifically to avoid duplicating. Rendered today only on
`/contacts/[id]`; wiring these into the company-wide `/compliance` ranking
and the `/alerts` engine is future work (see the interaction-log/follow-up
phase), not guessed at here.

### `ContactInteraction` — a relationship log, not an evidence record

A logged touchpoint with a `Contact`: a call, an email, a site visit, or a
plain note, with an optional follow-up date. New file `crm.prisma` — new
domain, new file, so this lane's schema changes don't collide with the
others' — even though `Contact` itself stays in `company.prisma`, which
every lane touches.

Deliberately **not** shaped like `Rfi`/`Submittal`/`SafetyIncident`: no
counter, no locked identity fields, no GC-facing correspondence copy. An
interaction log is an internal record a PM or estimator keeps on a
relationship, not a numbered document the other side also holds — so any
team member can log, edit, or delete one, the same access `BidInvitation`
already has on this page, and a correction just overwrites the row.

**Two separate user references, not one.** `loggedByUserId` is audit-only
(who actually recorded the entry, set once at creation) and
`followUpAssignedToUserId` is who owns the follow-up — deliberately
independent, because the person who logs a call is not necessarily the
person whose job the follow-up is. `occurredOn` is entered, not stamped,
same rule as every other date in this schema: logging a call from
yesterday has to record yesterday.

Gated behind `MANAGE_ESTIMATING` on `/contacts/[id]`, the same capability
that already gates Bid Invitations directly above it — relationship work
sits in the same bucket as pipeline work, and no new capability was added
to `lib/permissions.ts` for it (that map is the roles lane's territory).

Not wired into `/alerts` yet: a follow-up coming due only shows up by
visiting the contact page today. Surfacing it company-wide is explicitly
the next phase, not this one.

### `ContactPerson` — individual people at an account

`Contact` is the GC/developer/vendor's company; `ContactPerson` is the
individual there — their PM, their estimator, the owner's rep. Not a
second `Contact`: no jobs, no bid invitations, no portal access of its
own, since none of that is per-person. Lives in `crm.prisma` alongside
`ContactInteraction`, same reasoning (new domain, new file).

**No stored `lastContactAt`.** The obvious field to reach for, and
deliberately not added: it would be a second copy of a fact
`ContactInteraction` already states once `ContactInteraction` gains an
optional `contactPersonId`. "Last contact with Marcus Webb" is derived at
read time — on `/contacts/[id]`, by scanning that contact's interactions
(already fetched, already ordered newest-first) for the first one
attributed to each person — the same "derive, don't duplicate" rule as
every expiration date in this schema.

**`ContactInteraction.contactPersonId` is optional and `SET NULL` on
delete**, not `RESTRICT` like `contactId` on the same model. A person is a
name-and-title record with no history of its own; the interactions
themselves are the history. Deleting "Marcus Webb" because he left the
GC's office shouldn't be blocked by three years of call logs — those rows
just fall back to being attributed to the account alone. `deleteContact`'s
own guard was extended to count `ContactPerson` rows as history on the
*account*, though: an account with named people on file isn't a clean
delete even if it has no jobs or interactions yet.

No `isDecisionMaker` flag or role-based filter tabs, both present in the
original mockup for this feature — left out because neither is derivable
from anything else (a genuinely new bit of state) and neither was asked
for by name; easy to add later behind the same schema if wanted.

### `CONTACT_FOLLOW_UP` — a follow-up joins the alert engine, no schema at all

The fourth CRM item, and the first with no migration: `ContactInteraction`
already carries `followUpOn`/`followUpAssignedToUserId` (A2), so surfacing
one in `/alerts` is a pure addition to `lib/alerts.ts`/`lib/alerts-query.ts`
— a new `AlertKind`, a `contactFollowUpAlerts` derivation function, and one
new fetch block, none of it touching a table.

`lib/alerts.ts` is the shared alert-derivation engine every other lane's
kind lives in too (`RENEWAL`, `BACKCHARGE_RESPONSE`, `WIP_VARIANCE`, …), and
PR #59 (merged just before this) added a generic notification-dispatch
layer on top of it (`NotificationDispatch`, milestone rungs) that reads
`Alert.severity`/`.key` and knows nothing about individual kinds. Adding
`CONTACT_FOLLOW_UP` to `loadAlerts()`'s output means it gets digest/email
delivery for free — nothing in the dispatch layer needed to change.

Two things worth being explicit about, both surfaced in Slack before this
was written:

- **The horizon floor is 7, not chosen for feel.** `notification-milestones.ts`
  fires its "week" rung at `days <= 7` and its "approaching" rung off
  `severity` (i.e. `days <= horizon`). A kind with a horizon below 7 would
  have "week" cross before "approaching" ever does, silently dropping the
  earlier warning forever. `ALERT_HORIZON_DAYS.CONTACT_FOLLOW_UP` is 7, the
  same floor `CERTIFIED_PAYROLL` already sits on, and the constant's own
  comment says why so the next kind doesn't rediscover this the hard way.
- **Not scoped to `followUpAssignedToUserId`.** Every existing alert kind
  is capability-gated only — anyone holding it sees every alert of that
  kind company-wide, not just "theirs." Making follow-ups the first
  per-user-scoped kind would be a real behavior fork in shared code for a
  fairly small gain, so it stays consistent with the other seven: gated
  behind `MANAGE_ESTIMATING` (the same capability as the Interactions
  section it's drawn from), with the assignee's name in the alert's detail
  text rather than as a visibility filter.

No new "resolved" state either — a follow-up is retired by clearing
`followUpOn` on the interaction (already possible via `updateContactInteraction`),
which is also what changes the alert's key and lets a dismissal lapse
naturally, same mechanism as every other kind here.

## What proves this works (Phase 00's CRUD flow)

The minimal CRUD flow in `apps/web` exists specifically to demonstrate the
rule, not as sample UI to be replaced later:

1. `/jobs/new` creates a `Job` + `Contact` — this is opening an estimate.
2. Adding line items on `/jobs/[id]` writes directly to `JobLineItem` —
   this is "building the estimate."
3. The same `/jobs/[id]` page renders those rows as a contract-style
   summary (client name, scope, line items, total). No second write, no
   second table, no "generate contract from estimate" step exists because
   none is needed.
4. "Add change order" writes a new `JobLineItem` (add) or updates an
   existing one plus a `ChangeOrderLineItemEdit` (modify), and the
   summary reflects it immediately because it's reading the same rows.

If a future change to this codebase makes step 3 need to read from
somewhere other than `job.lineItems`, that change has broken the
foundation — revert it.

### `QuickBooksConnection` — accounting sync, connection only

One `QuickBooksConnection` per `Company`, storing the OAuth access/refresh
tokens and `realmId` (Intuit's company identifier) needed to call the
QuickBooks Online API on that company's behalf. It follows the same rule
as every other model here: it references `Company` and `User`
(`connectedByUserId`, who authorized it) rather than copying anything —
there is no QuickBooks-shaped duplicate of `Contact` or `Job` anywhere in
this schema.

~~**Scope, deliberately narrow:** this phase is the OAuth 2.0
`authorization_code` handshake, token storage, token refresh, and a
read-only connectivity check (fetching company info) — nothing more.
`Contact` rows are not pushed to QuickBooks as Customers, `Invoice` rows
are not pushed as QBO Invoices, and no accounting data is pulled back.~~

**OUT OF DATE — struck 2026-09-02, and this one had gone quietly wrong in
the expensive direction: it says money does not move and money moves.**
Invoice push is built. `pushInvoiceToQuickBooks` is
`lib/actions/quickbooks.ts:364`; the payload builder, the readback
verification, the blocker list and the duplicate-click window are
`lib/quickbooks-sync.ts` (`buildInvoicePayload`, `verifyPushedInvoice`,
`pushBlockers`, `idempotencyKeyFor`, `DUPLICATE_PUSH_WINDOW_MS`); payments
and reconciliation have their own modules
(`lib/quickbooks-payment-sync.ts`, `lib/quickbooks-reconcile.ts`), each
with tests. The invoice payload carries a `CustomerRef`, so a QBO customer
identity is part of it.

The "separate, larger decision (which direction is the source of truth?
what happens on conflict?)" was the right question and it has been
answered in code — by whoever built the above, not here. **This section
still needs someone who knows that work to write down what the answer
was.** Marked as a hole rather than guessed at: an audit can prove the
old paragraph false without being able to state the new design, and
inventing one would put this document straight back where it started.

The OAuth half is still accurate. See `packages/integrations/src/quickbooks.ts`
for the OAuth client, `apps/web/app/api/quickbooks/callback/route.ts` for
the redirect, and `disconnectQuickBooks`/`testQuickBooksConnection` in
`apps/web/lib/actions/billing.ts` — not in `actions/quickbooks.ts`, where
you would look for them, and not in `lib/actions.ts`, which no longer
exists.

Only the `com.intuit.quickbooks.accounting` and OpenID profile scopes are
requested — QuickBooks Payments is not, since this app already has its
own manual `Payment` tracking (see above) and isn't charging cards
through Intuit.

Tokens are stored as plain columns, not encrypted at rest. That's a
sandbox-appropriate tradeoff, made explicitly (not an oversight) — revisit
before this ever connects to a real production QuickBooks company. The
connect flow is `OWNER`-only, matching how `/team` gates membership
changes, since it's company-wide infrastructure, not per-job data.

CSRF protection for the OAuth redirect uses a random `state` value held in
a short-lived `httpOnly` cookie set by `initiateQuickBooksConnect` and
checked against the value Intuit echoes back to the callback route — no
database table for it, since it only needs to survive one redirect
round-trip.

## Field time tracking

`TimeEntry` records a single day's hours worked by one employee on one
job — optionally tied to a specific `JobLineItem` (cost code/SOV line)
and `CraftClassification`, mirroring the same optional link
`JobLineItem.craftClassificationId` already uses on the estimating side.
Straight/overtime/double-time/shift-differential hours are separate rows
rather than one row with a rate multiplier: a worker's mixed 8-hour day
(6 straight + 2 OT) is two clean rows, not one row needing a blended-rate
calculation to unwind later.

This tracks hours by category only — it does not compute dollar cost.
Turning hours into wages needs a rate-rule engine reading
`FringeRateSchedule` (per craft, per local, per pay type), which is
future-phase work, the same boundary `JobLineItem.laborHours` already
draws on the estimating side. Certified payroll report generation and
prevailing-wage rules both build on top of `TimeEntry` once it exists,
but neither is built yet.

`perDiemAmount`/`travelPayAmount` are flat daily allowances on
`TimeEntry` itself rather than a separate table — a per diem or travel
day is still one row for that employee/job/date, not a second entry to
keep in sync.

`DispatchSlip` is a distinct model, not a `TimeEntry` field: it's the
hiring hall's referral authorizing a worker onto this job, which happens
before any hours are worked and may never result in hours at all (a
no-show, or a job that gets pulled). The scanned slip (Vercel Blob) is
optional — some halls dispatch by phone with only a referral number.

Deliberately not built in this pass: a dedicated mobile/field time-entry
app. Every time entry and dispatch slip today goes through the same
responsive Next.js site as everything else. A real field app (offline
support, native camera access for slip photos, etc.) is a separate,
larger effort with its own design pass — the same category as
QuickBooks data sync or plan-takeoff via computer vision above, not
something to bolt onto this phase.

## Certified payroll and prevailing wage

`lib/labor-cost.ts` turns a `TimeEntry` into a burdened wage cost using
the `FringeRateSchedule` effective for its craft classification and
date — pure arithmetic, same reasoning as `lib/wip.ts`. Per prevailing-
wage/Davis-Bacon convention, overtime/double-time multiply the base wage
only; fringe benefits (pension, vacation, health & welfare, training)
are paid at their flat per-hour rate regardless of pay type. An entry
with no craft tag, or no schedule effective on its date, never gets a
guessed rate — it shows as uncomputed rather than $0.

`lib/certified-payroll.ts` rolls a week of a job's `TimeEntry` rows up
into one row per employee per craft classification — hours by pay type,
total hours, and computed wage cost — rendered at
`/jobs/[id]/certified-payroll`. This is a certified-payroll-*style*
summary, not a government-form-formatted WH-347/state-equivalent
export: replicating that exact form layout is a distinct, larger effort
this phase doesn't take on.

`PrevailingWageDetermination` is attached storage for the actual
government wage-determination document (or a link to one) per job — not a
lookup. There's no licensed or scraped prevailing-wage dataset in this app
to query automatically from, the same reason NV licensing data was left
unseeded in `LicenseClassificationReference`. **That has not changed and is
not going to until a licensed source exists.**

What HAS changed is the half of "multi-state variation" that never needed a
dataset. This paragraph used to say a rules engine was not built "for the
same reason", and that conflated two different things: a wage
DETERMINATION says what a classification pays, while a jurisdiction's
RULES say when an hour becomes overtime and how soon the report is due.
The second is not a rate, and it is now modelled — see the prevailing wage
rule sets section below.

## Retainage

`Job.retainagePercent` is the job's retainage rate — usually pre-filled
in the UI from `Contact.defaultRetainagePercent`, but independently
editable per job. `Invoice.retainageWithheld` is snapshotted from that
rate at the moment each invoice is created, not recomputed live: raising
or lowering a job's rate later never rewrites the retainage already
withheld on past invoices, the same reasoning `JobLineItem.budgetedUnitCost`
already uses for cost baselines.

`RetainageRelease` records retainage actually paid back to the sub — a
lump sum against the job's accumulated withheld balance
(`SUM(Invoice.retainageWithheld)`), not tied to any single invoice,
since retainage is typically released well after (and separately from)
the invoices that generated it. `lib/retainage.ts` computes the
outstanding balance as withheld minus released.

Release *forecasting* is a plain field
(`Job.substantialCompletionDate`) plus a computed statement in the UI
("expected release around this date"), not a scheduling or notification
system — there's no closeout/warranty stage in `JobStatus` yet for a
forecast to hook into more precisely than that.

## Union fringe and apprenticeship — two reports over hours already logged

Both halves of this were blocked on the same thing, and both comments
saying so are now corrected rather than left standing: there was no
time-entry data model. `TimeEntry` closed half of it. `CraftClassification.tier`
closes the other half.

### Why a tier column, rather than reading the name

An apprentice-to-journeyman ratio cannot be checked against a list of
names. "Drywall Finisher Apprentice Period 3" is only an apprentice to a
human reader, and deriving the tier by searching the name for "apprentice"
would be a guess that fails silently on the first local that words it
differently. `tier` is nullable with **no backfill**, for the usual
reason, and `FOREMAN` counts on the journeyman side — a judgement, so it
is stated in the enum rather than left implicit.

It sits on `CraftClassification`, which is a **global** reference table,
so setting a tier is visible to every company under that local. That is
correct rather than a leak: whether a classification is an apprentice
classification is a fact about the classification, the same as its name.
Access is gated by the company actually holding a `CompanyUnionAgreement`
with that local — the same join `craftClassificationIdFromForm` already
uses as its access check.

### The setup this reads from, and why it was missing

Both reports read five tables — `UnionLocal`, `CompanyUnionAgreement`,
`CraftClassification`, `FringeRateSchedule`, `ApprenticeRatioRule` — and
for a week none of them had a create action anywhere in the app. The
engines were verified against a database only a test could populate, so on
a real account both sections rendered empty with no way in. That is the
"a control that looks like it works and cannot" shape this codebase keeps
catching, and it was found by writing the browser click-list and noticing
step one was impossible.

The CRUD lives on `/union-compliance` itself rather than `/settings`,
beside the reports that consume it, so the gap between "no rate recorded"
and the place to record one is one screen.

Three of those tables are GLOBAL. A union local, its classifications and
its apprentice ratio describe the union, not the contractor, and the same
local applies to everyone working under it — so access is gated on holding
a `CompanyUnionAgreement` with the local, the same join
`craftClassificationIdFromForm` already uses. Two consequences follow:

- **A local another company already recorded is ADOPTED, not rejected.**
  The unique key is (`parentInternational`, `localNumber`); two
  contractors under Carpenters Local 300 are under the same real local. A
  duplicate-key error there would be the app telling someone a true fact
  is already taken.
- **The local and the agreement are created together.** A local with no
  agreement is invisible to the company that just typed it in, which reads
  as the save having failed.

Agreements and rate schedules are **ended, never deleted**: certified
payroll and remittances already filed under them have to keep computing to
the same figures. A classification with work tagged to it refuses deletion
and says how much — checked explicitly rather than left to the foreign
key, because the FK throws a raw error production redacts to a digest,
which tells the person nothing at all.

`setApprenticeRatioRule` **replaces** rather than adds. The schema permits
several rules per local and `loadRatioReviews` keys a Map on
`unionLocalId`, so a second rule would have decided the ratio by whichever
row sorted last — an answer that could change between reads with nothing
to explain it. The query now also orders deterministically, so the read is
safe regardless of what is in the table.

### The ratio is checked per day, and unclassified is never a pass

`lib/apprentice-ratio.ts` measures per job, per local, **per day**,
because that is how the rule is written and enforced. A crew that runs two
apprentices to one journeyman on Monday is out of ratio on Monday, and a
weekly or monthly average would hide precisely the day an inspector asks
about. It measures in HOURS, which is what `TimeEntry` holds; a headcount
derived from it would count a two-hour visit the same as a full shift, and
`programStandardReference` on the rule is where the company records which
convention its own standard states.

The load-bearing rule: **hours on a craft with no tier recorded are never
counted as journeyman hours.** The day reads `INCOMPLETE`. Counting them
would make a job look compliant because nobody had finished tagging its
crafts — turning a setup gap into a false clean bill of health on the
exact record an inspector asks for, which is the worst failure available
here. A day with apprentice hours and no ratio rule recorded is
`INCOMPLETE` for the same reason, and a day with no apprentice hours is
`NOT_APPLICABLE` rather than counted as evidence of compliance.

Hours that cannot be attributed to any local (no craft tag at all) are
folded into **every** local's review as unclassified. On a job running two
locals that makes both read `INCOMPLETE`, which is the conservative answer
and the correct one: the fix is to tag the entry, not to pick a local for
it.

### The remittance breaks the money out by fund

`lib/fringe-remittance.ts` rolls a month up per local, per classification,
with pension, vacation, health & welfare and training as separate figures
— because that is how the form is filled in and how the cheques are
written. A single "fringe" total would have to be taken apart again by
hand, which is the manual re-entry this product exists to remove.

It reuses `findEffectiveFringeRateSchedule` rather than a second copy: the
rate that applies to an hour is one question with one answer, and two
implementations would eventually disagree about a historical month. Fringe
is paid at the flat per-hour rate **regardless of pay type** — an overtime
hour earns time-and-a-half on the base wage and the same fringe as any
other — which is the Davis-Bacon convention `lib/labor-cost.ts` already
follows, and getting it wrong would overstate every remittance in a month
containing overtime.

Hours it cannot price (no craft tag, or no schedule effective on the day)
are counted in `uncomputedHours` with the workers named, and contribute
nothing to the money. Valuing them at zero would under-report a real
liability to a trust fund, which is the expensive direction to be wrong
in. Whether a month was filed is derived from a
`UNION_FRINGE_BENEFIT_FILING` document covering the **whole** period — a
filing that merely overlaps is not evidence, the same rule the
certified-payroll alert applies to a week.

## Prevailing wage rule sets — the rules, never the rates

There is still no wage-rate dataset in this app, nothing here is seeded,
and nothing here invents a wage. What `PrevailingWageRuleSet` records is
the other thing a jurisdiction sets: when an hour becomes overtime, when
it becomes double time, what the seventh consecutive worked day does, how
often certified payroll is filed and how soon. None of those is a rate,
and they genuinely differ — a jurisdiction with an eight-hour daily
threshold classifies the same timesheet differently from one with a
forty-hour weekly threshold.

Every value is **entered by the company** from the awarding body's own
documents, with `sourceUrl` for the citation. The row-level rule that
makes this honest rather than an assertion of law:

- **Null means no rule recorded.** `lib/prevailing-wage.ts` reports such a
  week as *unchecked*, never as compliant, and never assumes eight.
- **Zero is a different, meaningful value** — the premium applies from the
  first hour, which is how a seventh-day rule is usually written.
  Collapsing the two would erase exactly the distinction the review needs.

Effective-dated for the same hard reason `FringeRateSchedule` is:
reviewing last year's timesheet has to use last year's rules, and a
legislature amending a threshold must not silently rewrite how a closed
week reads. Non-overlap is enforced at the **database** level, hand-written
raw SQL in the migration exactly like `FringeRateSchedule`'s constraint,
because Prisma's DSL cannot express a Postgres exclusion constraint. If
two rule sets overlapped, "the rules that applied that week" would depend
on row order. Prisma Client does not know the constraint exists, so a
violation arrives as an untyped `P2010`; `lib/actions/prevailingWage.ts`
matches on the constraint NAME (not the word "exclusion", which would
swallow unrelated raw errors) and returns a sentence.

A rule set reaches a job through `PrevailingWageDetermination.ruleSetId` —
nullable, `ON DELETE SET NULL`. The determination is already the per-job
record saying "this job is prevailing wage in jurisdiction X", so nothing
new has to be joined, and deleting our own notes about the rules must
never take the awarding body's document with them.

### What the review does, and what it refuses to do

`reviewDays` splits each day by the daily rule (or the seventh-day rule
when it applies), then converts straight hours past the weekly threshold
into overtime **taking them from the latest days first** — you cross forty
at the end of a week, not at the start, and converting the earliest hours
would report Monday as overtime because of Friday.

It is reviewed **per employee**, never pooled per job. Two people each
working eight hours is not a sixteen-hour day, and pooling them would
manufacture overtime nobody worked — the single most damaging thing this
feature could get wrong.

It **never rewrites a `TimeEntry`.** `payType` is still entered by a
person; this reports where the entered split and the recorded rules
disagree, and a human decides which is wrong. Same shape as
`compliance-expiry.ts` reporting a stored licence status that contradicts
its own date: two human-entered facts, and which one is stale is not
knowable from here.

Days carrying shift-differential hours are shown and not judged — that
premium is for when the shift ran, not how long it was, so no hours-based
rule has anything to say about it. And `consecutiveDay` counts only within
the range passed in, so a seventh consecutive day spanning two weeks is
not detected; stated plainly rather than half-implemented.

One rule set field is load-bearing elsewhere: `filingDueDays` replaces the
certified-payroll alert's hardcoded seven-day horizon when a jurisdiction
has recorded one, and the alert says which of the two it used — "due in 7
days" from a citation and "due in 7 days" from our own default are not the
same claim.

## Roles: two orthogonal questions, not one enum

`UserRole` has two values and answers one question — can this person
ADMINISTER the company (invite, remove, connect an integration). This
feature does not touch it. Every `assertOwner()` in `lib/actions/*`
already means that and still does.

Job function is the second, orthogonal question: what does this person DO,
and therefore what do they need to see. Folding "estimator" and "foreman"
into `UserRole` would have made every existing owner-only guard ambiguous
overnight, and a permissions guard that means two things is a security bug
waiting for its first Monday.

`User.jobFunction` is nullable with **no backfill**, and that null is the
whole migration-safety argument. It means nobody has said, and the person
keeps exactly the access every `MEMBER` has had since multi-user companies
existed. Shipping this takes nothing from anyone until an owner chooses to.
`capabilitiesFor()` applies three rules in order: an OWNER holds
everything always; an unset (or unrecognised) function grants the full
member set; otherwise the function's list. The owner rule is not a
convenience — an owner locked out of their own books by a dropdown has
nobody to undo it on a single-owner company, which is most of them. The
unrecognised-value rule falls back to full access rather than none, because
a value this build does not know is far more likely to be a newer enum
member than an attack.

### Where it is enforced, and where it is only decorated

`requireCapability()` in `lib/authz.ts` is the boundary. Guarded pages call
it and render `<NoAccess>` — not a 404 and not a redirect, both of which
tell a foreman following a colleague's link that the app is broken and
produce a phone call.

`navGroupsFor()` filtering the rail is **cosmetic and says so in its own
comment**. Hiding a link hides nothing: the URL still exists and can be
typed or pasted. The two read the same `ROUTE_CAPABILITY` map, and a test
asserts `canReach()` and `can()` agree on every route for every principal,
so a link can never be shown to a door that will not open — nor, far worse,
a door left unlisted and unguarded.

Alerts carry the capability their SUBJECT needs (`ALERT_CAPABILITY`).
Without that the alert list would be a hole straight through the job
functions: a foreman with no billing access would still be told, by name
and to the dollar, that a $42,000 backcharge was unanswered. Money figures
are also stripped from alerts a restricted person may otherwise see — that
the GC has sat on the closeout package for six weeks is operational; what
it is holding up in dollars is a margin conversation.

### The three pages that render job money

`/jobs/[id]`, `/dashboard` and `/contacts/[id]` are reachable by everyone
— a foreman needs the job, the schedule and the GC's phone number — so
they are narrowed rather than refused. Each computes two flags once, at
the top, from the signed-in person:

```ts
const principal = { role: currentUser.role, jobFunction: currentUser.jobFunction };
const showsJobMoney = can(principal, "VIEW_JOB_COSTS");
const showsBilling  = can(principal, "MANAGE_BILLING");
```

Computed once rather than per section, so the contract summary, the WIP
table and the change-order log cannot end up disagreeing about whether
this reader may see a price. Both are TRUE for an owner and for a member
with no job function set, so all three pages render exactly as they always
have for everyone who has ever used them.

`showsJobMoney` gates the contract summary (which IS the prices), the
subcontract agreement and signing link (both carry the contract value),
job costing & WIP, the estimate line items and change-order log, job
health on the dashboard, pipeline and per-job contract value, and the
per-job total on a contact. `showsBilling` gates invoices, retainage, pay
applications, the overdue and retainage tiles, the whole Money section and
a GC's payment reliability.

**Whole sections, never filtered ones.** A WIP table with the money taken
out is still a WIP table, and half a screen of blanks reads as broken
rather than as withheld.

**One of these is a data question, not a markup question.**
`ReceivablesProvider` on the dashboard is a client component, so anything
handed to it reaches the browser whether or not a list renders it. It gets
`rows={showsBilling ? today.receivables : []}` — hiding the panel while
still shipping the rows would be the exact "looks enforced, is not"
failure this pass exists to close. Everything else on these pages is a
server component, so an unrendered section never reaches the browser at
all.

`lib/page-money-guards.test.ts` is a static regression guard: it asserts
each page still consults `can()` and still references its flags. It cannot
tell you a guard wraps the right section — only that a refactor has not
silently dropped the import and restored the hole with every test green.

What remains genuinely unbuilt is a mobile SURFACE. This is the same
responsive site, narrowed; an offline-capable field app with camera
capture is a separate build, not a permission, and FEATURE-AUDIT Sheet 25
keeps that row at Partial for that reason alone.

Per-company overrides of the capability map are not built. A settings page
editing a map nothing reads would be worse than the honest absence; where a
default was genuinely arguable (a PM holding `MANAGE_BILLING`, an estimator
holding `VIEW_JOB_COSTS`) the reasoning is written at the mapping itself.

## Alerts — derived, ranked, and acknowledgeable

There is no `Alert` table, and there is not going to be one. Every alert
this app raises already exists as a fact somewhere: a COI expiring is its
`expiresAt` against today, a backcharge going unanswered is its
`respondByDate` against its status, retainage coming due is withheld minus
released against an accepted `CloseoutSubmission`. Storing those would
create a second copy of a fact free to disagree with the first, which is
the rule this document opens with — and it is why
`lib/compliance-expiry.ts` was built with no migration at all.

`lib/alerts.ts` is the derivation and the ranking; `lib/alerts-query.ts`
assembles the inputs from real rows. Same split as
`renewals.ts`/`compliance-expiry.ts` and for the same reason: the deciding
half is where the bugs live and it has to be testable without a database.
Six sources feed it — renewals (through `compliance-expiry.ts`'s existing
ranking, not a second expiry rule), unanswered backcharges, retainage
release, a closeout package the GC is sitting on, certified payroll on a
prevailing-wage week, and jobs forecast over contract value (through
`jobIsOverBudget`, so the alert and the dashboard's Job health card can
never disagree about the same job).

### The one thing that IS stored, and why the key is shaped as it is

`AlertAcknowledgement` records a person deciding they have seen one. That
is not derivable from any row: "the office manager has dealt with this and
does not want to be told again until March" is a fact about a human.

The mechanism that keeps it honest is the key. An alert's key includes the
FACT that would change what it says, not just the row it is about:

```
RENEWAL:license_abc:2026-11-30      not   RENEWAL:license_abc
```

Renew that licence and the key changes, so an acknowledgement written
against the old one stops matching and the alert returns when the new date
comes round. Without that, "dismiss" would mean "never tell me about this
licence again", which is how an alert list becomes furniture. There is no
expiry logic beyond this; `alertKey()` is the only thing allowed to build
one, precisely so no call site can forget the third segment.

Acknowledgements are **per user**, not per company. Dismissing on a
colleague's behalf is the worse of the two failures available: the real
fix — renewing the licence, answering the backcharge — clears the alert
for everybody automatically, so a per-user acknowledgement can only ever
cause someone to see something twice, while a company-wide one can cause
the only person who would have acted to never see it.

### Three severities, and why a standing condition is not low priority

`OVERDUE` is a date that has passed, `DUE_SOON` a date coming, `STANDING`
a condition with no date attached at all. A job forecast over its contract
value is true today and will be true tomorrow; giving it a deadline would
make it indistinguishable from a COI lapsing on the 14th, which is the
distinction the list exists to draw. Within a severity, ordering is by
money first and date second — two overdue items are not equally urgent
when one is holding up $42,000 and the other a $400 cleanup charge.

Horizons are per kind (`ALERT_HORIZON_DAYS`, `CLOSEOUT_CHASE_DAYS`), the
same reasoning as `RENEWAL_HORIZON_DAYS`: the lead time you need is the
lead time the thing takes. `CLOSEOUT_CHASE_DAYS` is explicitly named a
chasing threshold rather than a deadline, because most subcontracts say
nothing about how long acceptance may take and asserting a contractual
date we do not have would be exactly the guess this codebase refuses.

### What it is not

**It is not push.** Nothing here emails, texts, or notifies anyone who is
not looking at the app. What it adds over the dashboard tiles that came
before is that an alert now has an identity, a severity comparable across
kinds, a place of its own reachable from every screen (the bell in
`Topbar`), and a record of whether a person has dealt with it. A delivery
channel needs an email sender, which does not exist on main, and Sheet 26
of FEATURE-AUDIT therefore keeps four of its rows at Partial rather than
flipping them to Built. The engine is the half that was actually missing;
when a sender lands, it feeds from here rather than replacing it.

Two alerts are also deliberately quieter than they could be. Certified
payroll is raised only for a job carrying a `PrevailingWageDetermination`
— it is not required on private work, and nagging about every job would
train people to ignore the one that matters. Retainage grounded on
`Job.substantialCompletionDate` is worded as "worth confirming" rather
than as money owed, because that column records when a job is EXPECTED to
reach substantial completion, not that it did (`lib/retainage.ts` learned
that the hard way and says so).

## Closeout: the package, and what is holding it up

`CloseoutItem`, `WarrantyPeriod` and `WarrantyServiceRequest` already
covered the checklist, the warranty clock and the callbacks. What sat
between "every required document is signed" and "retainage came back" was
the event that actually connects them — the package going to the GC — and
nothing recorded it. So a job could show a complete checklist next to a
retainage balance for four months with no way to tell whether nobody had
sent the package or the GC was sitting on it. Those have opposite fixes,
and the page could not tell them apart.

`CloseoutSubmission` is one attempt at handing that package over.
Deliberately several rows per job, exactly like `SubmittalRevision`: a
package that comes back short a lien waiver goes again, and collapsing
that into one row with an editable date would erase the fact that we sent
it on time the first time — which is the whole argument when retainage is
late. Attempts are numbered by `CloseoutSubmissionCounter`, which only
increments, for the reason every other counter here does. Dates are
entered; how long the GC has had it is derived per render.

**Submitting is not gated on a complete checklist.** Packages go out short
a document all the time, with the missing one promised to follow, and
refusing to record that would make the log stop matching what happened —
which is the one thing it is for. The blockers are shown next to the
submission instead, so an incomplete package that went anyway is visible
rather than impossible.

### `lib/closeout-readiness.ts` — whose move it is

Pure derivation, same family as `lib/retainage.ts` and `lib/wip.ts`. It
takes the required-item counts, open punch items, open callbacks, the
retainage balance and the latest attempt, and returns a stage —
`NOT_READY` / `READY_TO_SUBMIT` / `AWAITING_GC` / `REJECTED` /
`ACCEPTED` — plus an ordered blocker list and the money at stake. Nothing
is stored; there is no "ready" or "submitted" flag anywhere in this
feature.

Three decisions in it are load-bearing:

- **An open punch item blocks closeout, whether or not "punch list
  sign-off" is ticked.** The checklist is somebody's assertion and the
  punch rows are what can contradict it. `/closeout` reads
  `PunchListItem` and never writes it — punch lists are their own
  feature, and readiness only needs to know open ones exist.
- **Once the GC has answered, the submission decides the stage, not the
  blockers.** A callback logged the week after acceptance is warranty
  work, not something that un-closes the closeout. Reading it the other
  way round would put an accepted job back into `NOT_READY` the first time
  someone rang about a sticking door, and nobody would trust the column
  again. Blockers are still reported; they just stop deciding.
- **An empty checklist is a blocker, not a pass** — the same rule
  `isCloseoutComplete` already follows. Nothing has been asserted about
  that job, which is a different thing from nothing being wrong.

Retainage at stake comes from `calculateRetainageSummary`, the existing
implementation, rather than a second sum written here — the page's own
opening sentence has always said a missing lien waiver is money sitting
with the GC, and it had never shown the number.

## Backcharges — the change order running the other way

A `ChangeOrder` is us asking the GC for more money. A `Backcharge` is the
GC taking money off what they already owe us: cleanup we didn't do, damage
to another trade's work, a crew they brought in to finish our scope. The
two are the same conversation in opposite directions, and until this
landed only one of them existed in the schema — so the entire record of a
five-figure deduction was an unexplained short-pay on a cheque months
later.

It follows the evidence-record rules the RFI and submittal logs already
set. Numbers come from `BackchargeCounter`, which only increments, for the
same reason `RfiCounter` does: a number derived from the rows that still
exist is freed again by a delete, and then two different deductions have
both been "backcharge 3" in writing. Dates are ENTERED, not stamped —
`issuedOn` is the date on the GC's notice and `receivedOn` is when it
reached us, and those differ often enough to matter, because a notice
dated the 3rd that arrives on the 20th is most of a response window gone.
Whether we are past `respondByDate` is derived per render from that date
and the status, never stored.

**The one number that is stored, and the three that are not.** The
lifecycle is `RECEIVED` → `DISPUTED` → one of `ACCEPTED`, `SETTLED`,
`WITHDRAWN`. Only `SETTLED` carries `resolvedAmount`, because a negotiated
figure is the one outcome no other column can produce. Accepting concedes
exactly `claimedAmount`, which the row already holds; a withdrawal
concedes nothing. Writing either into `resolvedAmount` would be a second
copy of a fact the row already states, free to drift from it —
`concededAmount()` in `apps/web/lib/backcharges.ts` derives it from the
status instead, and returns null rather than guessing when a settlement
has no figure recorded.

**`claimedAmount` locks the moment we respond**, along with `issuedOn` and
the GC's own reference. Those three are what the GC put in writing, and
the page's "argued off" figure is `claimed − conceded`: if the claimed
amount stayed editable after a settlement, that figure would be reporting
a claim nobody ever made. Before we answer, the row is only our own
transcription of a letter, so a typo in it is worth fixing — which is also
the only window in which one can be deleted. After that it is half of an
exchange the GC also holds; the exit is resolving it as withdrawn, which
is what actually happened if they dropped it.

**It deliberately does not touch `Invoice`.** Netting an accepted
backcharge against a pay application is real work in the billing lane —
it changes what a pay application asks for, which the GC sees. A nullable
`invoiceId` nobody sums would look built while changing no number
anywhere, which is the exact failure mode this codebase has now shipped
several times (a settings card that connected nothing, an action with no
caller). So `/backcharges` says on the page that these figures are a log
of what the GC has charged us and not a deduction from any invoice,
contract value or WIP number. The same applies to job costing: an accepted
backcharge is a real cost, but `CostEntry` hangs off a `JobLineItem` and
picking which line a GC's cleanup charge lands on is a decision this phase
does not make.

## Multi-tenancy and roles

Every `Contact` and `Job` belongs to a `Company`. Every `User` belongs to
exactly one `Company` (linked via Clerk's `clerkId`). All queries in
`apps/web` scope by `companyId` from the authenticated user's session —
there is no cross-company data access path.

Multiple users can now share a Company. The first person to sign in
creates the Company and becomes its `OWNER`. An `OWNER` can invite a
teammate by email (`Invite`, see `apps/web/lib/actions/company.ts` and
`requireCompanyContext()` in `apps/web/lib/auth.ts`) — the invite itself
still sends no email; the `OWNER` shares the normal `/sign-up` link out of
band, and matching the invited email on first sign-in attaches that person
to the existing Company as a `MEMBER` instead of creating a new one.

~~`MEMBER`s have full access to jobs, contacts, and costing; the only
thing gated by role today is team management itself (inviting, removing,
canceling an invite) — `OWNER` only. Finer-grained per-feature permissions
are future-phase work if it turns out to be needed.~~

**Struck 2026-09-02 — this document contradicted itself by about 300
lines.** Finer-grained per-feature permissions shipped on 1 Sep and this
file describes them at length under "Roles: two orthogonal questions, not
one enum" above: `User.jobFunction`, `capabilitiesFor()`,
`requireCapability()` in `lib/authz.ts`, the `ROUTE_CAPABILITY` map, and
the `showsJobMoney`/`showsBilling` narrowing on `/jobs/[id]`,
`/dashboard` and `/contacts/[id]`. A `MEMBER` does not necessarily have
full access to costing any more. The correct summary is the one above;
this tail paragraph was simply never updated when the section was added.

Worth naming the failure rather than just deleting it: a document long
enough to say a thing twice will eventually say it two ways, and the
stale copy is usually the summary rather than the detail — because the
person adding a feature writes a new section and does not grep for older
sentences about it. Before adding a section here, grep this file for the
subject first.

Two things are still true as written: `UserRole` remains two values
answering only "can this person administer the company", and every
`assertOwner()` still means exactly that. Also corrected: the invite
paragraph said "there is no email-sending integration for this", which
read as "this repo has no email sender". It has one —
`packages/integrations/src/email.ts` (Resend), used by
`sendOutboundEmail` and the alert digest. Invites just do not use it.

## Future phases (explicitly not built yet)

These are deferred on purpose, not forgotten. Do not stub them out "for
completeness" — that produces half-built abstractions this phase is
specifically trying to avoid.

- **AI features** — the first priority item (WIP/over-under-billing
  variance) shipped as deterministic math (`lib/wip.ts`) plus an AI
  narrative layer over it (see above) — the first feature that actually
  calls Claude. `ComplianceDocument` extraction and draft-estimate-from-text
  are both built next: uploading a document on `/compliance` reads it into
  structured fields (`extractComplianceDocument`), and pasting scope-of-work
  text on a job's estimate (`/jobs/[id]`) breaks it into draft
  `JobLineItem` rows (`draftEstimateLineItems`) — same forced-tool-call
  pattern, same `aiExtracted`/`aiDrafted` "please verify" flag rather than
  a lock, in both cases. Plan-takeoff via computer vision is a distinct,
  later, larger effort — different input modality, different accuracy
  bar, deliberately not bundled into this phase.
- ~~**QuickBooks data sync** — the OAuth connection itself is built (see
  `QuickBooksConnection` above); actually pushing/pulling `Contact` or
  `Invoice` data to/from QuickBooks is not. That needs its own design pass
  for sync direction and conflict handling before it's built.~~
  **Struck 2026-09-02: this is BUILT, and a "not built yet" list is the
  worst place to be wrong** — its whole job is telling someone what they
  are allowed to assume is missing, and a wrong entry here invites a
  second implementation of something that already moves money. Invoice
  push, payment sync and reconciliation all exist:
  `pushInvoiceToQuickBooks` (`lib/actions/quickbooks.ts:364`),
  `lib/quickbooks-sync.ts`, `lib/quickbooks-payment-sync.ts`,
  `lib/quickbooks-reconcile.ts`, each with tests. See the corrected
  QuickBooks section above, which also notes that the sync-direction
  design still needs writing down by whoever built it.
- **Real payment processing** — `Payment` rows are manual records (check,
  cash, card handled elsewhere), not charges. Actually collecting a card/
  ACH payment in-app needs a processor (e.g. Stripe) and its own API keys
  — a deliberately separate decision from the invoicing/tracking built
  now.
- **Trade-specific modules beyond the `TradeScope` tag** — no calculators,
  compliance-tracking UI, or catalog/template system yet. `TradeScope`
  (see above) is a categorization dimension only.

When any of these get built, the test is the same one this document
opens with: does it read and write `JobLineItem` (extended as needed), or
does it introduce a second shape that needs to be kept in sync by hand?
If it's the second one, stop and redesign.
