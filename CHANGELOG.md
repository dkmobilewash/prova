# Changelog

What actually changed, in plain English, newest first.

**Rule: update this in the same PR as the work.** A changelog maintained
separately from the code drifts away from it within a week — exactly how
FEATURE-AUDIT.md on `main` twice ended up claiming features that weren't
there. If a PR changes behaviour, it edits this file too.

Entries say what changed and why it mattered, not which functions moved.
`git log` already covers the functions.

---

## 2026-08-28

### Material order and delivery tracking per job (Cyrus)
`cyrus/material-orders`

What's on order, who owes it, and whether it turned up. Material that
doesn't arrive is a crew standing around, and "the studs were three weeks
late" is worth nothing in a delay conversation without the date it was
ordered and the date the vendor promised.

**It deliberately carries no quantity and no unit price.** A
`MaterialOrderLineItem` with quantity and price would be a second live
copy of line-item data, which is the one thing ARCHITECTURE.md forbids.
Material cost already has a home (`CostEntry` against a `JobLineItem`) and
scope already has a home (`JobLineItem`). This model answers only what
neither of those can: is it here yet, and if not, who is late. A link from
an order to a specific `JobLineItem` was considered and deferred — it
would be a pure addition, but it touches the unified line-item model,
which is the other lane's core surface.

- **Numbers** come from `MaterialOrderCounter`, incremented in the same
  transaction as the insert. Never `max(n)+1`. Check: delete the highest
  order and the next one issued must not reuse its number.
- **Partial deliveries are their own rows**, not a pair of columns on the
  order — half the studs Tuesday and the rest whenever is the normal case.
  A delivery can be marked as closing the order out, and removing that
  delivery is how a wrongly-closed order reopens.
- **State is derived, never stored**: awaiting / partly delivered /
  delivered comes from the deliveries on every render. A stored status can
  disagree with the deliveries underneath it, and then "still waiting on
  it" and "it's all here" are both on screen at once.
- **An order with no promised date is never late.** Nobody committed to
  anything, so there is nothing to be late against — inventing a date to
  measure against would manufacture lateness no vendor agreed to.
- **Guards**: a promised date before the order was placed, a delivery
  before the order was placed, and a second delivery against an order
  already closed out. The last reads the closing delivery INSIDE the
  transaction — checked outside, two people receiving the same truck both
  pass and the order closes twice with two different completion dates.
- **The ordered date is not editable after creation.** Every delivery is
  measured against it, so moving the start of the clock would retroactively
  rewrite the lateness of deliveries already recorded. The promised date
  *is* editable — a vendor moving their own commitment is normal and has to
  be recordable.

### A successful write can render as an empty page (Cyrus)
`cyrus/material-orders`

Found by driving the browser, not by any check. Created a material order:
the action returned ok, the form closed, the row was in the database — and
the page rendered "Nothing on order". The dev server log had the reason:

    Timed out fetching a new connection from the connection pool
    (Current connection pool timeout: 30, connection limit: 5)
    prisma:error Error in PostgreSQL connection: Error { kind: Closed }

The write committed; the revalidated re-render couldn't get a connection,
so the page queried nothing and honestly reported nothing.

**Why this is worse than an error page.** The user sees a successful save
followed by a list that says the thing isn't there. The natural response
is to save it again — so the failure mode of an exhausted pool is
DUPLICATE RECORDS, silently, with no error anywhere the user can see.
Vercel's serverless functions open a connection per invocation, so
production is more exposed to this than localhost, not less.

Reproduced and then ruled out as a code bug: after restarting the dev
server with a healthy pool, the same create refreshed the list correctly.
Two things that looked like bugs and were not — the "Log an order" button
appearing dead, and creates never refreshing — were both this plus a
hydration mismatch from a ColorZilla browser extension injecting
`cz-shortcut-listen` into `<body>`.

Nothing is fixed here; this is a record of the failure mode. The
connection budget is worth a look before more concurrent users exist.

### `ActionResult` moved to `lib/actions/shared.ts` (Cyrus)
`cyrus/material-orders`

Submittals defined `ActionResult` locally as the first module in the
returned-failure shape. Adding a second such module broke the build:
`lib/actions/index.ts` does `export *` from every domain file, and two
modules exporting the same type name is `TS2308`. The type and its `ok`/
`fail` helpers now live in `shared.ts`, which is deliberately not a
`"use server"` module and is never re-exported from the barrel — so there
is exactly one definition and no collision. Both submittals and material
orders import it from there.

Worth noting the failure mode: two structurally identical copies of a type
in two feature modules is invisible until a third feature adds a third
copy. The barrel caught it at `typecheck` this time; it would not have
caught two copies that had drifted apart in shape.

---

## 2026-08-27

### Production redacts thrown Server Action messages — settled by result (Cyrus)
`cyrus/submittals`

Ran a real production build locally (`pnpm build` + `next start`) and
tripped the RFI answered-before-sent guard. Dev shows the plain sentence;
production rendered the generic "An error occurred in the Server
Components render… omitted in production builds" text. So every
`throw new Error("plain language")` in the app degrades to boilerplate
for a real user while reading perfectly in dev. Open question 2 from the
08-26 review entry is no longer open.

The check that catches it: a production build run locally, then clicking
a guard. Neither typecheck, lint, dev-mode clicking, nor a green deploy
would ever show it.

### Submittals — first module written in the returned-error shape (Cyrus)
`cyrus/submittals` — FEATURE-AUDIT category 16

- New `/submittals` page. `Submittal` + `SubmittalRevision` +
  `SubmittalCounter` in `operations.prisma`, new
  `lib/actions/submittals.ts`. One line each in `middleware.ts`,
  `Sidebar.tsx` and the actions barrel.
- **Because of the redaction finding above, these actions RETURN their
  failures** — `{ ok: true } | { ok: false, error }` — and the forms
  render `error` from the result. `throw` is reserved for genuine bugs,
  which should be redacted. The type is module-local until both lanes
  agree on a shared one in `shared.ts`; converting the older
  throw-based modules is its own piece of work.
- **The submittal's status is derived from its latest revision on every
  render, never stored.** A stored status can disagree with the revision
  that produced it, and that contradiction is how someone builds from a
  superseded drawing. States: not sent / with the GC / revise-and-resubmit
  (our court) / approved.
- **Each round trip to the GC is its own revision row** with entered —
  never stamped — sent/due/returned dates, because the turnaround per
  revision is the delay-claim evidence. Revision numbers come from a
  counter on the submittal row, incremented in the sending transaction;
  submittal numbers come from `SubmittalCounter` per job. Same rule as
  RFI and safety case numbers: nothing derived from surviving rows.
- **A sent package can never be deleted** — it is correspondence the GC
  also holds. Only a registered-but-never-sent one can.
- Ordering guards: a response can't predate its revision's send; a
  resubmission can't predate the response that caused it; a second
  revision can't go out while the GC still has the first. The send
  guards read the latest revision inside the sending transaction —
  checked outside it, two people resubmitting at once would strand a
  revision no form could ever respond to.
- An approved package can still take a new revision (a design change
  after approval is normal); what it can never do is have its recorded
  stamp falsified to get there.

### `/rfis` list header no longer calls every visible row "open" (Cyrus)
The header said "N open" but counted drafts and answered RFIs — the
tiles' `isOpen` means awaiting an answer, so the two disagreed on the
same screen. The list header now says "in play"; the open tile keeps its
stricter meaning.

## 2026-08-26

### Adversarial review of RFIs and Safety — seven defects fixed (Cyrus)
`cyrus/rfis`

Two independent reviews were run against the RFI and Safety code looking
for defects rather than approval. Everything below passed typecheck, lint
and a full production build, and none of it would have been caught by
those. Most severe first:

- **A sent RFI could be deleted.** `deleteRfi` allows drafts only — but
  `updateRfi` re-derived status from the dates, so clearing the sent date
  on a sent RFI turned it back into a draft, and then it deleted. That
  destroys correspondence the GC also holds and leaves a permanent hole in
  the numbering. `sentOn` can no longer be cleared once set.
- **Editing an RFI reopened a withdrawn one.** Same re-derivation: a
  closed-without-answer RFI went back on the open list when someone fixed
  a typo in its subject. Status is now preserved on edit; draft → sent is
  the only transition an edit can make.
- **A same-day answer was impossible.** `markRfiSent` stored a wall-clock
  instant while every other date is stored at UTC midnight, so an answer
  dated today compared as *earlier* than a send stamped at 14:30 and was
  rejected — with a message blaming the user for correct data.
- **Date inputs defaulted to the server's UTC date.** At 17:00 in
  California the UTC date is already tomorrow, so a form opened at the end
  of a shift pre-filled tomorrow. On a safety incident that is worse than
  a wrong date: on 31 December it picks the wrong case-number series, and
  the incident date is not editable afterwards. Defaults now come from the
  user's own calendar; storage and rendering stay UTC.
- **Safety day counts were enforced only by the form hiding the inputs.**
  A direct action call could store `FIRST_AID_ONLY` with 40 days away, and
  the log would print a row contradicting itself. Cleared server-side
  unless the outcome is one OSHA counts days for.
- **`assertOwner` said "Only the account owner can manage team members" at
  all 18 call sites** — deleting a vendor, an invoice, a punch-list item.
  Pre-existing. Now a generic default with a specific message where useful.
- **The cost/schedule impact tile counted only visible rows,** so it fell
  to zero as answered RFIs were closed — exactly as the work got done. It
  is a job-lifetime figure and is now counted from the database.

**Known and not fixed here, deliberately:**

- The `add_safety_case_counter` migration seeds the counter from
  `MAX(caseNumber)` — the same derivation the feature exists to avoid. For
  a database where cases were deleted *before* the migration ran, a number
  can still be reissued once. There is no recoverable record of deleted
  numbers, so no better seed exists; rewriting an already-applied
  migration is its own hazard. Flagged rather than hidden.
- **Next.js redacts thrown Server Action errors in production builds.** If
  that holds here, every plain-language guard message in the app degrades
  to an opaque digest for the user — across both lanes, not just these
  features. Needs verifying against a real deployment and, if confirmed, a
  move from `throw` to a returned `{ ok, error }` shape. That is its own
  piece of work.
- A wrong incident date can only be corrected by deleting and re-filing,
  which retires the case number. Whether an owner should be able to edit
  the date within the same year is a product decision, not a bug fix.

### RFI log (Cyrus)
`cyrus/rfis` — FEATURE-AUDIT category 16

- New `/rfis` page. `Rfi` + `RfiCounter` in `operations.prisma`, new
  `lib/actions/rfis.ts`. Its own page, nothing in Diego's lane.
- **Built as an evidence record, not a task list.** The dates are the
  product: sent, answer-needed-by, and the date the answer actually came
  back. An RFI sent and answered three weeks late is what a delay claim is
  argued from.
- **Overdue is derived from the dates on every render, never stored.** A
  stored overdue flag is correct for one day. `today` comes from the server
  so the server and browser can't disagree about the date.
- **The sent date is entered, not stamped, and can be backdated.** The first
  version stamped `sentOn = now` behind a "mark as sent today" checkbox.
  That made the first real use of the feature impossible: entering the RFIs
  you already sent over the last three weeks would record every one as sent
  today, and the response-time evidence — the whole point of the log —
  would be fiction. Blank sent date means draft; status follows the date
  rather than being set separately, so the two can't disagree.
- **An answer can't be dated before the RFI was sent.** Found by clicking:
  the row rendered `sent 2026-08-26 · answered 2026-08-23 · -3 days`. A log
  that can hold an answer arriving before the question discredits itself,
  and a negative day count is the number someone would quote in a dispute.
  Rejected in the action; the row also refuses to render a negative count
  for any record predating the check.
- **The answer date is entered, not stamped.** Recording an answer that
  arrived last Tuesday must not read as arriving today, or the log
  overstates the GC's response time — which destroys its value as evidence
  in the direction that matters.
- **RFI numbers use the same counter pattern as safety case numbers**, for
  the same reason: a GC references "RFI 12" in writing, so a number that
  comes back after a deletion points at two different questions.
- **A sent RFI cannot be deleted, only closed.** Deleting it destroys
  correspondence the other side still holds. Drafts can be deleted.
- Cost and schedule impact are flags set when the answer is read. They
  deliberately do not create a change order — they mark which RFIs to pull
  when someone builds one.

### Pre-existing: `nextChangeOrderNumber` has the same reissue bug (open)
`apps/web/lib/actions/shared.ts` computes change order numbers as
`max(number) + 1`. Nothing deletes a change order today, so the reissue
path isn't reachable — but the concurrency race is: two people adding a CO
to the same job at the same moment both read the same max, and one gets a
raw Prisma unique-constraint error. Flagged to Diego rather than fixed
here; `shared.ts` and change orders are his lane.

### FEATURE-AUDIT.md corrected
It still listed categories 17, 19, 20 and 22 as `0 built` while vendors,
equipment, punch lists, daily field reports and safety were all on main.
Second time this file has drifted in a day. Corrected against what's
actually in the schema.

### Neon connection pooling (Cyrus)
`cyrus/db-pooling`

- **Every page in the app was returning a 500**, local and deployed alike:
  `Timed out fetching a new connection from the connection pool`. Not a
  code change — the app had always pointed at Neon's **direct** endpoint,
  which allows very few connections, while Prisma opened a pool of 17.
- Fixed by using Neon's **pooled** endpoint (`-pooler` in the hostname) for
  `DATABASE_URL` and keeping the direct endpoint as `DIRECT_URL`, which
  `prisma migrate` requires — a pooler can't run migrations. Datasource now
  declares `directUrl`.
- Pool dropped to 5 connections, timeouts raised to 30s. Neon suspends an
  idle compute; the first request after a quiet period has to wake it, and
  the 10s default expired during the wake.
- **This was worse in production than locally.** Vercel is serverless —
  each invocation opens its own connection, so the direct endpoint
  exhausts far faster there. It had never been caught because nobody had
  loaded the deployed app end to end.
- **Anyone with a local checkout must add `DIRECT_URL` to their `.env`,
  and both variables must be set in Vercel project settings.** Neither is
  fixed by pulling the code.

### Safety & field operations (Cyrus)
`cyrus/safety` — FEATURE-AUDIT category 17

- New `/safety` page with two records: the incident log and toolbox talks.
  New `SafetyIncident` and `ToolboxTalk` models in `operations.prisma`, new
  `lib/actions/safety.ts`. Nothing outside my lane was touched — one line
  each in `middleware.ts` and `Sidebar.tsx`.
- **Case numbers are issued by a counter row that only increments
  (`SafetyCaseCounter`), not computed from the incidents.** The first
  version took `max(caseNumber) + 1`, which is wrong: delete the *highest*
  case and the max drops back, so the next case reissues that number. A row
  count fails the same way. Anything derived from the rows that still exist
  can be reissued, because deleting a row changes the answer — caught by
  clicking it, not by any check that passed. The counter is incremented in
  the same transaction that creates the incident, which also settles the
  race where two people file simultaneously and both read the same value.
  The migration seeds the counter from existing incidents so numbering
  continues rather than restarting. Case number and year are not editable
  after creation — they identify the case on a document that may already be
  filed.
- **"Recordable" is derived from the outcome, never stored.** Everything
  except first aid is recordable on the 300 log. Storing it as its own
  field lets it disagree with the outcome, which is exactly the kind of
  contradiction an inspector finds.
- **`jobId` is optional on incidents.** Injuries happen in the yard, the
  shop and in transit, not only on jobs. Requiring a job would train people
  to attach the incident to whatever job was handy, which corrupts the
  record more than a blank field does.
- Day counts (away / restricted) only appear for the two outcomes where
  OSHA counts them. Showing them otherwise invites numbers that don't
  belong on the log.
- First aid cases are logged too, and the empty state says why: a first-aid
  case that later turns into lost time is only defensible if it was written
  down the day it happened.
- Dates stored at UTC midnight and rendered in UTC, same rule as daily
  field reports.
- Create and inline-edit share one `SafetyIncidentFields` component so the
  two forms can't drift. Two-step delete, owner only, no `window.confirm`.

### Daily field reports (Cyrus)
`cyrus/field-reports` — WORK-SPLIT task 3

- New `DailyFieldReport` model and a section at the end of the job page:
  crew on site, work performed, weather, delays. One entry per job per day.
- **Weather and delays are the reason this exists.** A delay claim or a
  schedule dispute months later gets argued from these, and nothing
  captured them before.
- **One report per job per day, enforced by the database**
  (`@@unique([jobId, reportDate])`), not by code. Two people filing the
  same day would leave contradictory records of what happened — worse than
  one person editing an existing entry. The duplicate error is caught and
  turned into plain language rather than surfacing a Prisma code.
- Dates are stored at UTC midnight and rendered in UTC. Rendering in local
  time would show the previous day for anyone west of UTC.
- `crewPresent` is free text rather than a link to `JobAssignment`: the
  crew that shows up rarely matches the roster, and forcing the link would
  make people record the roster instead of the truth.
- The report date is not editable. It's the identity of the record — filed
  against the wrong day, delete and re-file.

**Touching `jobs/[id]/page.tsx`, which is Diego's file:** 19 insertions,
0 deletions. One import, one additive `include`, one `<section>` at the
very end. Agreed with him in #prova-build before writing.

Not done: no photos, no per-report crew hours (that's `TimeEntry`), no
copy-yesterday shortcut.

### Split the two files we kept colliding in (Cyrus, agreed with Diego)
`cyrus/split-shared-files`

Every feature either of us built edited `packages/db/prisma/schema.prisma`
and `apps/web/lib/actions.ts`. PR #6 conflicted in exactly those two files
and nothing else — not a feature collision, just two people appending to
the same file. This makes that structurally impossible.

- **Schema** is now `packages/db/prisma/schema/` — 7 domain files
  (`company`, `jobs`, `estimating`, `labor`, `billing`, `compliance`,
  `operations`) plus a header file holding only the generator and
  datasource. Grouped by domain rather than one file per model: 36 files
  would mean hunting relations across the tree for no gain.
- **Actions** are now `apps/web/lib/actions/` — 9 domain modules plus
  `shared.ts`. `index.ts` re-exports them, so every existing
  `@/lib/actions` import works unchanged. No call site was touched.

Pure move. Same 51 models, same 67 exported actions, same bodies. Verified
by diffing the sorted names before and after.

**Two things this turned up that were not obvious:**

1. With a multi-file schema, Prisma expects `migrations/` **inside** the
   schema folder. Left where it was, `prisma migrate status` reported
   "No migration found" and then "Database schema is up to date!" in the
   same breath — because with nothing to compare, nothing looks wrong.
   `migrate deploy` would have applied nothing to a fresh database. The
   check that catches this is `migrate status` naming real migrations, not
   the absence of an error.
2. Next.js rejects `export *` inside a `"use server"` file — it can't prove
   a wildcard only yields async functions. The barrel is therefore a plain
   module; each domain file carries its own `"use server"`, and a
   re-exported action keeps that identity from where it's defined.
   `pnpm typecheck` does not catch this. Only `pnpm build` does.

Also applied 6 migrations from Diego's merge that had never been run
against the local database.

### Punch lists (Cyrus)
`cyrus/punch-lists` — WORK-SPLIT task 5

- New `PunchListItem` model and `/punch-lists` page. What still has to be
  fixed before a job closes out. `JobStatus` runs ESTIMATE → COMPLETE with
  nothing in between, so until now this list lived in someone's memory of
  the walkthrough.
- Filter by job or see everything at once; completed items hidden by
  default with a toggle. A super walking three jobs wants everything still
  open, not one job at a time.
- Checking an item off is one click and reversible, so it asks nothing.
  Delete still asks twice.
- "Raised by" comes from the signed-in user, not a form field — nobody
  types their own name during a walkthrough.
- The add form deliberately stays open after saving, unlike vendors and
  equipment: punch items get logged in bursts, five in a row on the same
  job. Job selection is kept, description clears and refocuses.

**Built as its own page rather than a section on `jobs/[id]/page.tsx`.**
WORK-SPLIT assigns that file to Diego and he's been editing it this week,
so this avoids the collision entirely. The per-job section can be added
later as a thin read of the same model — the data doesn't change.

Not done: no due dates, no photo attachments, no assignment to a person.

### Equipment inventory (Cyrus)
`cyrus/equipment` — WORK-SPLIT task 4

- New `Equipment` model and `/equipment` page. What the company owns —
  scaffolding, lifts, mixers — and which job each item is on right now.
  Unassigned means "in the yard", a normal state rather than missing
  data, so the list header counts both.
- Type is free text rather than an enum. Categories vary too much by
  trade to fix a list now, and guessing wrong means a migration to add
  the one type a contractor actually owns.
- Deleting a job returns its equipment to the yard rather than deleting
  it along with the job.
- Built on the vendor pattern as fixed below, not the bare version.

Not done: no equipment cost allocation into job costing. Step one is
knowing what you own and where it is.

### Vendor directory — edit, delete confirmation, collapsible form (Cyrus)
`cyrus/vendor-edit`

- **Vendors can be edited.** Previously add and delete were the only
  operations, so fixing a typo in a phone number meant deleting the vendor
  and retyping every field. Edit swaps the row for a form in place.
- **Remove asks twice.** It sits next to Edit; a misclick shouldn't
  silently destroy a hand-typed record. Two-step button rather than a
  browser `confirm()`, which is blocked in some embedded browsers and
  can't be styled.
- **The add form is collapsed behind a button.** Open by default it filled
  the viewport, so you scrolled past six empty fields to reach the
  directory. Looking a vendor up is the common case; adding is occasional.
- Fields extracted into `VendorFields` so the create and edit forms share
  one definition and can't drift apart.

Not done: no search or filtering — fine at this size, will need it past
~50 vendors.

### Vendor/supplier directory (Cyrus)
`cyrus/vendor-directory` — WORK-SPLIT task 2

- New `Vendor` model and `/vendors` page. Records who you buy from —
  board and steel suppliers, scaffolding, equipment rental. Until now a
  material cost was a dollar amount with no source attached.
- Trade scope is optional. Fastener and equipment-rental suppliers serve
  every trade; forcing a choice would record something false.
- Owner-only delete, matching every other company-level record.

Not done: no link between vendors and jobs, costs, or pricing history yet.
It's a directory.

### CI has never passed — fixed (Cyrus)
`fix(ci)`

- Every CI run since the repo was created failed in about ten seconds. The
  workflow declared the pnpm version in two places — `version: 10` in
  `.github/workflows/ci.yml` and `packageManager` in `package.json` — and
  `pnpm/action-setup@v4` aborts rather than choosing. Install, lint,
  typecheck and build never ran, on any commit, by either of us.
- Removed the workflow's version pin; `package.json` is the source of
  truth and the action reads it automatically.
- CI now takes about 2m20s and actually checks things.

Note: pushing changes to `.github/workflows/` needs a token with the
`workflow` scope. Without it the push is rejected.

### TRAILER company location type (Cyrus)
`cyrus/trailer-location-type` — WORK-SPLIT task 1

- Added `TRAILER` (a job-site field office) alongside HQ, BRANCH_YARD and
  WAREHOUSE.

---

## Open, not owned by this changelog

Tracked here because both of us keep rediscovering them:

- **Five features are on `claude/app-access-confirmation-ik5ise`, not on
  `main`** — line-item catalog, subcontract storage, field time entry,
  per diem/travel pay, dispatch slips. `main`'s FEATURE-AUDIT.md counts
  them as built. Verify with `git log main..origin/<branch> --oneline`.
- **Default branch is still `claude/brave-allen-dmu1e7`.** A fresh clone
  does not land on `main`.
- **The repo is public.** An unauthenticated clone succeeds.
- **The Anthropic API key was emailed in plain text** and has not been
  rotated.
