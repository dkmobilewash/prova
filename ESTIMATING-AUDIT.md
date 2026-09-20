# Estimating audit — what exists today

Ordered by Diego, 2026-09-20, as the input to deciding what to build next.
Read against `a734a74` (`origin/main`).

## How this was established, and its one real limit

Every claim below was read out of the code on `main` and is cited to the
file that carries it. **No test was executed and no page was clicked.**
`pnpm install --frozen-lockfile` cannot complete in this container: the
egress proxy answers 403 to `CONNECT cdn.sheetjs.com:443`, which is where
`xlsx@0.20.3` is fetched from, so the install aborts and there is no
`node_modules` to run vitest against. That is an environment fact, not a
repo fact — the same install works on a laptop.

So this is a READING, to this file's own standard: a reading is weaker
evidence than a run, and weaker again than a click. Two consequences,
stated rather than buried:

- Nothing here says a feature WORKS. It says a feature EXISTS, with the
  line that implements it.
- The gaps are the strong half. "There is no model, no column, no action
  and no route for X" is a claim a grep can settle, and those are the
  findings this audit rests on.

Where a behaviour matters and is already pinned by a test, the test is
named so the next person can run it rather than re-derive it.

## The map — where estimating actually lives

There is no estimating page. `/estimating` is a redirect to
`/dashboard?status=ESTIMATE` (`apps/web/app/(app)/estimating/page.tsx`),
and the file says why: a job starts as an estimate, so estimates are jobs
filtered by status. **The estimate is the job detail page**, which is the
single most important structural fact in this audit and the one that
shapes every recommendation at the end.

| Surface | Route / file | What it is |
| --- | --- | --- |
| The estimate itself | `app/(app)/jobs/[id]/page.tsx`, the `isEstimateStage` branch | Line items, takeoff, AI draft, catalog insert, estimate versions, "ready to lock this in" |
| Estimate list | `/dashboard?status=ESTIMATE` | Jobs grouped by status, each estimate carrying a derived stage badge |
| Price book | `/catalog` | `LineItemCatalogEntry` CRUD, CSV/paste import, actuals feedback |
| Bid history | `/bids` | `BidInvitation` log, filterable by trade and outcome |
| Pre-bid chase | `/pipeline` | `BidPursuit` — projects being chased before any GC invited us |
| Vendor quotes | `/vendors/pricing` | `VendorPriceQuote` against catalog entries |
| Cost coding | `/phase-codes` | `PhaseCode`, and budget-vs-actual by phase across every job |

All of `/catalog`, `/bids`, `/pipeline` and `/vendors/pricing` gate on the
`MANAGE_ESTIMATING` capability (`lib/permissions.ts` `ROUTE_CAPABILITY`).
The estimate section of the job page gates on `VIEW_JOB_COSTS` instead
(`showsJobMoney`), so a field-tier user reads the schedule and files
reports on the same page without seeing the pricing.

Data model: `packages/db/prisma/schema/estimating.prisma` (BidInvitation,
EstimateVersion + its counter, TradeScope, CompanyTradeScope,
LineItemCatalogEntry), `pursuits.prisma` (BidPursuit), and `jobs.prisma`
(Job, **JobLineItem**, ChangeOrder and its proposal/edit tables, PhaseCode,
CostEntry).

Pure logic: `lib/takeoff.ts`, `lib/estimate-labor-cost.ts`,
`lib/estimate-stage.ts`, `lib/catalog-actuals.ts`, `lib/catalog-import.ts`,
`lib/bid-pipeline.ts`, `lib/bid-pursuits.ts`.

Writes: `lib/actions/estimating.ts`, `lib/actions/jobs.ts`,
`lib/actions/bidPursuits.ts`, `lib/actions/vendorPricing.ts`, over the
lifted cores in `lib/estimating/` that the Ask commands share.

## What exists — verified

### Getting quantities onto an estimate, four ways

1. **Type a line.** The "Add line item" form on the job page:
   description, qty, unit, unit price, budgeted cost, trade, labor hours +
   craft, phase code. `addLineItem` (`lib/actions/jobs.ts`).
2. **Add from the catalog.** Pick an entry, give a quantity; the entry's
   price, cost, trade, craft and hours copy onto a new `JobLineItem`, with
   `sourceCatalogEntryId` recording the template and `priceBasis:
   COMPANY_CATALOG`. `lib/estimating/catalog-line.ts`.
3. **Draft from scope text.** Paste a scope of work; Claude returns lines,
   grounded in this company's catalog and its last 40 WON bids. Every row
   is flagged `aiDrafted`, and `priceBasis` records whether the number came
   from the catalog, a historical bid, or general market knowledge — three
   different amounts of trust, deliberately not one badge.
   `lib/estimating/draft-lines.ts`, `PriceBasis` in `jobs.prisma`.
4. **Takeoff.** `lib/takeoff.ts` + `components/TakeoffForm.tsx`: type
   measured dimensions for one wall or one ceiling, see the quantities
   computed live, save them as line items. Wall gives drywall area, sheets,
   studs, track; ceiling gives area and sheets. Waste %, stud spacing,
   sheet size and the opening-deduction threshold are all arguments with
   documented defaults, on the stated principle that a hidden default bids
   somebody else's practice. The server recomputes from the dimensions and
   ignores the browser's numbers. Covered by `lib/takeoff.test.ts`.

### Pricing and labor

- Per line: `unitPrice` (nullable — a cost-only line), `budgetedUnitCost`
  (frozen baseline), `currentEstimatedUnitCost` (live forecast),
  `estimatedCostToComplete` (PM override), `laborHours`,
  `craftClassificationId`, `phaseCodeId`, `tradeScope`.
- **Burdened labor cost at bid time.** `lib/estimate-labor-cost.ts` runs
  estimate hours through the SAME `findEffectiveFringeRateSchedule` /
  `calculateTimeEntryLaborCost` the actuals use, at straight time, priced
  at the job's planned start date so a job starting after a union increase
  is bid at the rate that will be paid. Shown as a read-only hint beside
  the hours field; never written into `budgetedUnitCost`; shows nothing
  rather than a wrong number when no schedule is effective.

### The price book, and the loop back into it

- `LineItemCatalogEntry`: description, unit, trade, default unit price,
  default budgeted cost, default labor hours, craft.
- Built up from real work — "Save as catalog item" on any estimate line —
  with a duplicate guard that refuses a second copy at a different price,
  because two copies split the actuals and hide a bad price on both.
- **Bulk import**: paste from a spreadsheet or upload a CSV, headers
  matched loosely, preview showing what will be added / what is already
  there / every row it could not read, before anything is written.
- **Actuals feedback** (`lib/catalog-actuals.ts`): what the template says a
  unit costs against what it has actually cost across every line created
  from it, variance flagged past 15% on 2+ costed lines, one click to
  update the default. Counts only COMPLETE jobs, and says how many costed
  lines it excluded for being unfinished — a part-built line reports a
  fraction of its unit cost, every unfinished job biases the same way, and
  re-pricing off that walks the catalog toward zero.

### Versioning, conversion, deletion

- `EstimateVersion`: a manual "save version" JSON snapshot of the current
  line items, with a note and an author. Numbers come from
  `EstimateVersionCounter` through the transaction client (#289) — before
  it, two concurrent saves collided on `@@unique([jobId, versionNumber])`
  in 49 of 50 measured rounds.
- `markJobContracted`: the same line items become the contract. No copy,
  no parallel table. After it, edits go through the change-order lifecycle
  (DRAFT → SUBMITTED → APPROVED, with only APPROVED touching
  `JobLineItem`).
- `deleteEstimateJob`: owner-only, ESTIMATE-only, refuses with a reason.

### Around the estimate

- **Derived estimate stage** (`lib/estimate-stage.ts`): Needs pricing →
  Ready to send → Out for signature → Signed, computed from line-item
  count and signature-request statuses, rendered as a badge on the
  dashboard. Nothing stored.
- **Bid history** `/bids`: `BidInvitation` per GC — trade scope, bid
  amount, due date, INVITED/SUBMITTED/WON/LOST/DECLINED. Filterable, with
  a won-value total.
- **Bid pipeline** `/pipeline`: `BidPursuit`, the pre-bid chase, with
  "gone quiet" (30 days untouched), "bid date coming up" (30 days) and
  "bid date passed with no invite" all derived on every read.
- **Win rate** `lib/bid-pipeline.ts`: per GC, counting decided bids only,
  UNCOMPUTED rather than 0% when nothing has been decided.
- **Ask box**: `create_estimate_job`, `add_catalog_line`,
  `draft_estimate_lines`, `create_bid_invitation`, `create_bid_pursuit`,
  `reschedule_job` — all DIRECT over the lifted cores in `lib/estimating/`.
- **Export**: jobs, job line items, estimate versions, change orders, the
  price book.

## What does not exist

Each line below is a grep that comes back empty across `apps/` and
`packages/`, not an impression.

### 1. There is no markup, margin, overhead or profit anywhere

`markup`, `marginPercent`, `overheadPercent`, `profitPercent` and
`contingency` appear in this codebase only as CSS margins and as the word
"contingency" in a comment describing a cost-only line.

An estimate is `unitPrice × quantity` with `budgetedUnitCost` sitting
beside it. **The estimator does the O&P arithmetic off-screen and types
the result into `unitPrice`.** There is no bid summary sheet, no
cost-to-price step, no "this bid carries 14% gross margin", no company
default markup, and no way to re-price a whole estimate to a target
margin. `lib/wip.ts` computes gross profit AFTER the fact, from actuals.

For a sub that bids 6-10 jobs a month, this is the largest single gap on
the list: the number that decides whether the bid makes money is the one
number the product does not hold.

### 2. A takeoff cannot be revised, and it is not priced

`addTakeoffLineItems` (`lib/actions/jobs.ts`) computes the quantities
and creates `JobLineItem` rows with **description, unit and quantity
only** — no unit price, no budgeted cost, no trade, no craft, no phase
code, no catalog link. And there is no takeoff model: the dimensions,
waste %, spacing and openings are discarded the moment the lines are
created.

So: the wall height changes, and there is nothing to edit. You re-enter
the dimensions, and you get a second set of lines beside the first. The
docstring in `lib/takeoff.ts` names "takeoff-quantity-to-estimate mapping"
as the missing leg the competitors have; the quantity half is built and
the mapping half is not.

The calculator's own scope is also narrow, and honestly so: one wall or
one ceiling at a time, drywall/framing only. No assemblies, no wall types,
no ceiling grid, hangers or wire (deliberately — stated as a guess without
the reflected ceiling plan), no insulation, corner bead, tape or finish
levels, nothing for lath and plaster, EIFS or fireproofing. Four of the
five `TradeScope` families have no takeoff math at all.

### 3. The catalog cannot hold a productivity rate

This is already written up in full in
`changelog.d/cyrus-catalog-labor-hours-meaning.md` and the decision in it
is **open and waiting on a person** — it is repeated here because it is a
blocker for labor estimating, not a loose end.

`defaultLaborHours` copies onto a line FLAT at every quantity, while
`defaultUnitPrice` and `defaultBudgetedUnitCost` are per-unit figures the
page multiplies out. The two writers of the column disagree:
`saveLineItemAsCatalogEntry` puts a line's TOTAL hours in;
`importCatalogEntries` maps a price list's hours column in, and that is a
per-unit productivity factor. `Decimal(8, 2)` cannot hold one anyway —
0.012 hrs/SF stores as 0.01, a 17% error before anything multiplies it.

The labels now say which reading the code implements, and the import
sample stopped teaching the other one. The arithmetic is unchanged and one
of the two writers is wrong today. `lib/estimating/catalog-line.test.ts`
pins the flat behaviour at quantity 1 AND quantity 100 — the pairing is
the test, since at quantity 1 the two readings are indistinguishable.

**Until this is decided, a specialty sub cannot keep its crew production
rates in C Stream**, which is where the risk in this trade actually lives:
quantity takeoff is ~97-98% accurate while projects overrun ~28%.

### 4. A bid invitation is never linked to its estimate

`BidInvitation` has no `jobId`, and `estimating.prisma` says so outright —
"linking a won BidInvitation forward to its Job is a future refinement,
not built here."

So `/bids` holds a `bidAmount` somebody typed, the job holds line items
that total to something, and nothing reconciles them. "What did we bid
this at" has two answers that can disagree, the historical bid database
that grounds the AI drafts is hand-keyed rather than derived from the
estimate it came from, and win rate cannot be read against the estimate's
own cost structure.

`BidPursuit` → `BidInvitation` IS linked (`bidInvitationId`, unique, SET
NULL). The chain breaks at the last hop, which is the one that carries the
money.

### 5. There is no bid proposal document

The only thing that goes to a GC before award is a **signing link**.
`createSignatureRequest` (`lib/actions/billing.ts`) works at ESTIMATE
stage and renders `ContractSummary` — company, client, scope, line items,
total — which has `print:` rules and is printed from the browser. There is
no PDF generator anywhere in the app that produces one (the PDF code that
exists is DocuSign and uploaded-document handling).

And there is no place to put what a wall-and-ceiling sub's bid actually
says. **No inclusions, no exclusions, no clarifications, no
qualifications, no alternates, no unit-price schedule, no allowances** —
those words return nothing across the schema and the app. A sub's bid
letter is scope AND the fence around it; C Stream holds the scope and
none of the fence.

The flow it does support is coherent for the award itself: sign in
C Stream, or `recordExecutedSubcontract` for the GC's own paper plus
`ContractDocument` for the file. It is the bid that has no document.

### 6. Nothing chases a bid due date

`Job.bidDueDate` is stored (entered, never set from the web) and is read
in exactly one place: `JobBidDetails.tsx`, which prints it on the job
page. There is no `BID_DUE` alert kind in `lib/alerts.ts`, the dashboard
does not sort or badge by it, and the estimate-stage badge does not know
it exists. A bid due Friday looks exactly like a bid due in March.

`BidPursuit.expectedBidDate` DOES drive "coming up" and "passed with no
invite" on `/pipeline` — so the pre-bid chase is watched and the actual
bid is not, which is backwards.

### 7. Estimate versions can only be read, never used

A version renders as a line: number, date, author, note, and the
descriptions of its items. There is no compare, no diff against current,
no restore, and no total — the snapshot holds quantities but the page
never prices them. "What did we price this at before the scope changed",
the question the model comment says versioning exists to answer, needs the
reader to hold two lists in their head.

### 8. No estimate is ever reused

There is no duplicate-job, copy-estimate, clone-line-items or
start-from-a-previous-bid anywhere. Every estimate starts empty, even the
fourth one this year for the same GC on the same building type. The
catalog carries single lines forward; nothing carries a SHAPE forward.

### 9. Vendor quotes never reach an estimate

`VendorPriceQuote` hangs off a catalog entry and is read only on
`/vendors/pricing`. Nothing writes a quote into a line's
`budgetedUnitCost` and nothing compares a quote against the catalog
default. `estimating.prisma` states the intent — "read-only reference for
estimating" — so this is by design; it is listed because "I have three
quotes, use the low one" is the ordinary motion it does not support.

### 10. No estimate-accuracy report at the bid level

`/phase-codes` gives budget vs actual by phase code across every job, and
`/catalog` gives it per catalog entry. Neither answers "we bid this job at
X, it cost Y" across jobs, by GC, by trade scope, or by estimator. The
data is all present — `BidInvitation.bidAmount`, line items, `CostEntry`
— and no read assembles it.

### 11. Bids, pursuits and vendor quotes are not exported

`lib/export.ts` lists them as a deliberate omission under the `pipeline`
key: `BidPursuit`, `BidInvitation`, `VendorPriceQuote` (with the CRM
models). The contact is exported; the work of winning it is not. This is
declared rather than accidental — `export.test.ts` fails the day one of
them IS exported — but for an estimating-heavy customer it means the
estimating history cannot leave.

## FEATURE-AUDIT.md is not wrong, and it is misleading

Sheet 03 reads **"Estimating & Bidding — 10 built · 0 partial · 0
missing"**. Every one of those ten rows is genuinely built; I checked each
against the code and none is a false claim.

But "0 missing" is a statement about the ORIGINAL 26-category roadmap's
row list, not about the product, and read at a glance it says estimating
is finished. Two specifics:

- The row for takeoff reads *"Material takeoff quantities per line item
  (manual entry v1) — `JobLineItem.quantity` / `.unit`"*. `lib/takeoff.ts`
  and `TakeoffForm` are not mentioned on the sheet at all. The sheet
  UNDER-states what shipped, and simultaneously implies the category is
  complete.
- Not one of the eleven gaps above is a row on that sheet, so none of them
  can ever make it read anything other than 0 missing.

The fix is a row list that grew with the product, not a status change.
That is a separate piece of work and should ride with whatever gets built
next, per rule 1 of the working agreement.

## What I would build, in order

**Revised 2026-09-20 against `ESTIMATING-MARKET.md`**, a browser survey of
eight takeoff/estimating products. Read that file's first paragraph before
this section: nothing in it was verified from inside this repo, so it is
good enough to decide a build order from and not good enough to put in a
product claim. The previous version of this section is in `git log` — three
things moved, and the reasons are recorded here rather than in the diff.

**What the market survey changed:**

1. **`defaultLaborHours` moved from last to first.** Every surveyed product
   that is an estimating tool rather than a measuring tool stores the rate
   PER UNIT — Sage as hours-per-unit or units-per-hour, Procore as
   `Quantity × Labor(hrs) × Difficulty`, Quick Bid as Qty/Hr-Day, STACK as
   a Coverage Rate. Not one stores a flat per-line figure. The open
   question in `changelog.d/cyrus-catalog-labor-hours-meaning.md` now has
   one-sided evidence, and everything else in labor estimating waits behind
   it.
2. **Inclusions and exclusions moved up.** Only Procore models them as
   structured objects. Quick Bid — the incumbent in our trade — has merge
   fields for alternates and unit prices and NONE for exclusions; they are
   static text you retype into a Word template. Five products have nothing
   at all. It is the widest open gap in the survey and the cheapest thing
   on this list to build.
3. **Drawing measurement came OFF the list entirely.** Five independent
   sources agree that AI plan reading returns a wall centerline and stops:
   wall height is in the sections, wall type is in the partition schedule,
   and no product joins them. Building a PDF canvas would be the most
   expensive thing here and would not answer our user's question.

**Tier 1 — the two decisions everything else waits on.**

1. **Settle `defaultLaborHours` and make it a production rate.** Per unit,
   with a precision that can hold 0.012 hrs/SF (`Decimal(8, 2)` cannot),
   plus a separate adjustment factor for height, access and occupied
   conditions — Sage's Productivity Adjustment and Procore's Difficulty are
   the same idea and both keep the base rate clean. Fix whichever of the
   two writers is wrong. **Announce the migration in Slack before the
   push.** `estimateBurdenedLaborCost` already works and starts earning the
   moment this lands.
2. **Markup and a bid summary.** Build it as an ORDERED STACK of typed
   adjustments per cost type, not one percentage field — that is the shape
   all four reference designs share, with overhead entering the cost base
   before profit and bond computed last on the marked-up total. Make
   markup-on-cost vs margin-on-price an explicit per-bid setting the way
   Quick Bid does, rather than an assumption nobody can see.

**Tier 2 — the bid becomes a document.**

3. **Inclusions / exclusions / clarifications / alternates / unit prices**
   as structured, reusable, versioned objects, rendered on
   `ContractSummary` so they ride the signing link and the print view. A
   company-level library of standard exclusions is the half that saves the
   retyping.
4. **Bid due dates that chase.** A `BID_DUE` alert kind and a due-date
   badge on the estimate rows. `Job.bidDueDate` already holds the data;
   this is a read, an alert and a badge.
5. **Link the bid invitation to the job.** `BidInvitation.jobId`, nullable,
   no backfill, so `bidAmount` can default from the estimate total and two
   disagreeing numbers become visible instead of silent.

**Tier 3 — the estimate stops being retyped.**

6. **Assemblies, keyed on wall type.** One named partition type that
   expands to board, studs, track, tape and finish at a stated height. This
   depends on 1, and it is the layer the AI products cannot reach: they
   detect the centerline, and the schedule-to-assembly join is unclaimed in
   all eight.
7. **A takeoff that persists and re-runs.** Store the dimensions rather
   than discarding them, so a changed wall height is an edit instead of a
   second set of lines. Revision handling is unsolved across the whole
   market — every product ships a manual visual diff — and we have the easy
   version of the problem precisely because we have no PDF canvas.
8. **Duplicate an estimate** from a previous job; compare two estimate
   versions with totals.

**Tier 4 — the things the market left open.**

9. **Vendor quote → line item budgeted cost.** Structured supplier-quote
   ingestion is absent from every product surveyed except Sage's Bid Grid,
   and a wall-and-ceiling sub prices board, stud and grid off negotiated
   quotes rather than a national index. `VendorPriceQuote` already exists
   and nothing reads it.
10. **Starter trade content for the five trade scopes.** Every product that
    ships assemblies ships them unpriced, a PlanSwift user needed a month
    to build theirs, and no surveyed product is documented as shipping
    wall-and-ceiling content. The honest competitive claim is "usable on
    day one without a database build", and this is the missing third of it
    — the catalog already builds itself from real lines, and
    `catalog-actuals` already feeds real costs back.
11. **Bid-vs-actual across jobs**, by GC, trade scope and estimator.
12. Takeoff math for the other four trade scopes.

**Explicitly not building:** PDF measurement, scale calibration, or AI plan
reading. See `ESTIMATING-MARKET.md`.

Nothing above needs a new page. Items 2, 3, 7 and 8 all land in the
`isEstimateStage` branch of `jobs/[id]/page.tsx`, which is already the
estimate and is already Diego's lane — and per CLAUDE.md that file has
fixed section slots with nothing in the file marking them, so read that
entry before editing it.
