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

**Explicitly not built**: change orders still apply immediately on
submission with no draft/approval state, so there's no signature flow for
change orders yet — only the initial contract. Adding one would mean
giving `ChangeOrder` a pending/approved lifecycle of its own, which is a
larger change than extending the existing signature flow. Natural next
increment if it's needed.

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

**Explicitly not built**: file storage. No decision has been made about
where an uploaded PDF would live (Vercel Blob, S3, etc.), and the planned
AI-extraction feature (reading a scanned lien waiver/COI into these
fields) may not even need to persist the source document — just the
structured data pulled from it. Both AI extraction and file storage are
future phases, blocked on a real Anthropic API key — see Future phases.

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

**Scope, deliberately narrow:** this phase is the OAuth 2.0
`authorization_code` handshake, token storage, token refresh, and a
read-only connectivity check (fetching company info) — nothing more.
`Contact` rows are not pushed to QuickBooks as Customers, `Invoice` rows
are not pushed as QBO Invoices, and no accounting data is pulled back.
Wiring actual sync is a separate, larger decision (which direction is the
source of truth? what happens on conflict?) that this phase intentionally
doesn't answer. See `packages/integrations/src/quickbooks.ts` for the
OAuth client and `apps/web/app/api/quickbooks/callback/route.ts` +
`initiateQuickBooksConnect`/`disconnectQuickBooks`/`testQuickBooksConnection`
in `apps/web/lib/actions.ts` for how it's wired up.

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

## Multi-tenancy and roles

Every `Contact` and `Job` belongs to a `Company`. Every `User` belongs to
exactly one `Company` (linked via Clerk's `clerkId`). All queries in
`apps/web` scope by `companyId` from the authenticated user's session —
there is no cross-company data access path.

Multiple users can now share a Company. The first person to sign in
creates the Company and becomes its `OWNER`. An `OWNER` can invite a
teammate by email (`Invite`, see `apps/web/lib/actions.ts` and
`requireCompanyContext()` in `apps/web/lib/auth.ts`) — there is no
email-sending integration for this; the `OWNER` shares the normal
`/sign-up` link out of band, and matching the invited email on first
sign-in attaches that person to the existing Company as a `MEMBER`
instead of creating a new one. `MEMBER`s have full access to jobs,
contacts, and costing; the only thing gated by role today is team
management itself (inviting, removing, canceling an invite) — `OWNER`
only. Finer-grained per-feature permissions are future-phase work if it
turns out to be needed.

## Future phases (explicitly not built yet)

These are deferred on purpose, not forgotten. Do not stub them out "for
completeness" — that produces half-built abstractions this phase is
specifically trying to avoid.

- **AI features** — the first priority item (WIP/over-under-billing
  variance) shipped as deterministic math (`lib/wip.ts`) plus an AI
  narrative layer over it (see above) — the first feature that actually
  calls Claude. `ComplianceDocument` is also built — schema only, ready to
  receive lien waiver/COI/certified payroll/union fringe filing records,
  but nothing populates it yet. Next up: AI extraction of scanned
  documents into `ComplianceDocument` rows, then draft-estimate-from-text.
  Plan-takeoff via computer vision is a distinct, later, larger effort —
  different input modality, different accuracy bar, deliberately not
  bundled into this phase.
- **QuickBooks data sync** — the OAuth connection itself is built (see
  `QuickBooksConnection` above); actually pushing/pulling `Contact` or
  `Invoice` data to/from QuickBooks is not. That needs its own design pass
  for sync direction and conflict handling before it's built.
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
