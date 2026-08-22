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
What it does gate (enforced server-side in `apps/web/lib/actions.ts`, not
just hidden in the UI) is *how* those rows may be changed:

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
- **A job-costing line** — later phases that track actual cost vs.
  estimated cost add columns to this same row (e.g. `actualCost`), not a
  parallel `CostingLine` table.

There is no transformation step where an "estimate" becomes a "contract"
or a "budget." They were never different things.

`isDeleted` is a soft delete. When a change order removes scope, the row
is flagged rather than destroyed, so the job's history stays intact and
nothing that was once billed disappears from the audit trail.

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
for this phase — it's a compliance/audit concern, not a foundation
concern, and building it now would mean guessing at a shape before a real
e-sign/compliance flow (a later phase) defines what "the signed version"
actually needs to capture. The `ChangeOrderLineItemEdit` log gives you the
field-level diff, which is enough to answer "what changed and when" today.
Revisit this if/when Phase "compliance & e-sign" needs stronger
guarantees.

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

## Multi-tenancy

Every `Contact` and `Job` belongs to a `Company`. Every `User` belongs to
exactly one `Company` (linked via Clerk's `clerkId`). All queries in
`apps/web` scope by `companyId` from the authenticated user's session —
there is no cross-company data access path in Phase 00. A permissions/
roles model beyond "belongs to this company" is future-phase work.

## Future phases (explicitly not built yet)

These are deferred on purpose, not forgotten. Do not stub them out "for
completeness" — that produces half-built abstractions this phase is
specifically trying to avoid.

- **AI features** — no assist/automation of any kind yet.
- **QuickBooks / accounting sync** — `packages/integrations` is an empty
  placeholder for this and other future integrations.
- **Scheduling** — no calendar, crew assignment, or timeline model yet.
- **E-sign / compliance flow** — no legally-binding signature capture,
  and (see above) no line-item snapshotting at signing. When this phase
  lands, it should read `JobLineItem` at the moment of signing rather
  than introducing a parallel "signed contract" table.
- **Client portal** — clients have no login or view of their own yet;
  `Contact` is purely a record the contractor manages.
- **Billing** — no invoicing, payments, or draw schedules.
- **Trade-specific modules** — no framework yet for trade-specific line
  item templates, catalogs, or workflows.

When any of these get built, the test is the same one this document
opens with: does it read and write `JobLineItem` (extended as needed), or
does it introduce a second shape that needs to be kept in sync by hand?
If it's the second one, stop and redesign.
