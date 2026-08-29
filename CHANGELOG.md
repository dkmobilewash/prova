# Changelog

What actually changed, in plain English, newest first.

**Rule: update this in the same PR as the work.** A changelog maintained
separately from the code drifts away from it within a week — exactly how
FEATURE-AUDIT.md on `main` twice ended up claiming features that weren't
there. If a PR changes behaviour, it edits this file too.

Entries say what changed and why it mattered, not which functions moved.
`git log` already covers the functions.

---

### Deleting a catalog entry now asks twice (Diego)

Browser testing found it: four deletions, four rows gone on the next
render, no confirm anywhere. Every other list in the app already asks
twice — this one was written with a bare form posting straight to the
action, and neither typecheck, lint, tests nor the build has any opinion
about that.

Worse than an ordinary misclick, because of something invisible on the
row. A `JobLineItem` records the catalog entry it was priced from, and
that relation is optional — so Prisma's default is to NULL the link
rather than refuse the delete. The line items survive intact. What dies
is the actuals feedback loop for that work, silently, with nothing on
screen ever mentioning it. So the confirm step names how many costed
lines are about to be unlinked. That is the number that should make
someone stop, and it was the number nobody could see.

`deleteLineItemCatalogEntry` now returns `ActionResult` instead of
throwing. Production redacts thrown Server Action messages, so the old
`throw new Error("Catalog entry not found")` would have reached a user as
an unexplained failure.

Two smaller things from the same test run. The import preview derived a
trade label by lowercasing the enum, so a row previewed as "lath plaster"
and saved as "Lath & plaster" — nothing wrong with the data, but a
preview whose wording doesn't match what lands is a preview you stop
trusting, and that preview is the only thing between a bad file and the
catalog. Both now read from one `trade-scopes.ts`. And the active nav
link carried its state in colour only; it now also carries
`aria-current="page"`.


### The app now works on a phone (Diego)

Half a subcontractor's people are in the field, and the app assumed a
desktop. The sidebar was a fixed 240px full-height column with no
responsive rules at all and no drawer — on a 360px screen that left a third
of the width to work in. Not a cosmetic problem: most of the crew couldn't
use it.

The rail is now desktop-only (`md:` and up) and gains `sticky top-0`, so it
stays put instead of scrolling away on a long job page. Below `md` the same
links live in a drawer opened from the top bar.

Both read from one shared `NAV_ITEMS` list. That is the point of extracting
it: a route added to the rail and forgotten in the drawer would be a page
that exists on a laptop and not on a phone, which nobody notices until a
foreman reports it.

Drawer behaviour worth naming, each because its absence reads as the tap
not working: navigating closes it, Escape closes it, tapping the backdrop
closes it, and the link list scrolls on its own so the close button can't be
pushed off screen.

Also fixed: `ContractSummary`'s table had no scroller of its own, so on a
phone it dragged the whole page sideways. It renders on `/esign` and the
client portal — the two places an outside party sees, and the one a client
signs on their phone. Every other table in the app already had one.

Not fixed here, and worth being straight about: this is the shell, not a
mobile design pass. Individual pages still lay out for a wide screen, and
the forms are dense. The app is now usable on a phone; it is not yet good
on one.


### Duplicate records from an exhausted pool: the half that's fixable (Diego)

Follow-up to the connection-pool finding below, which was documented and
deliberately not fixed. Two halves; one is fixed here, one is not.

**Fixed: the second click.** Whatever makes a page look like it didn't
save — an exhausted pool, a stale render, a slow request — the duplicate
record comes from the user submitting again. Every create in the app was a
plain `<button>` inside a server-rendered `<form action={serverAction}>`,
which stays clickable for the whole round trip, and no create action is
idempotent. `components/SubmitButton.tsx` uses `useFormStatus` to disable
the button while its own form is in flight; 57 buttons across 7 files now
use it. The one `type="button"` toggle in the change-order UI is left
alone, since it submits nothing.

This is worth stating plainly: it does not fix the pool. It removes the
mechanism by which a pool problem becomes a *data* problem.

**Fixed: silence.** The app had no error boundary anywhere, so a failed
render fell through to Next's default screen, which in production says
only that a server exception occurred. After pressing Save that answers
the wrong question. `app/(app)/error.tsx` now says the page failed to
load, that this does not necessarily mean the save failed, and — the part
that matters — not to submit again before reloading to check. It surfaces
`error.digest` so a report can be traced in the Vercel logs.

**Not fixed: the connection strategy.** Deliberately, because it can't be
verified from here and this is production.

`Error in PostgreSQL connection: Error { kind: Closed }` is the tell. Those
are connections Prisma still believes it holds, closed underneath it —
consistent with Neon suspending an idle compute. Prisma's pool then hands
out dead connections and drains, and the 5-connection budget is exhausted
by connections that no longer exist. That is why it presents as pool
exhaustion under load that isn't actually heavy.

Three options, in increasing order of how much they actually fix:

1. `pool_timeout=30` means a request waits **thirty seconds** before
   failing. Lowering it doesn't prevent anything, but it turns a half-minute
   stall into a fast, visible failure — which the new error boundary now
   explains properly.
2. Prisma sits in front of Neon's pgbouncer with a pool of its own, and
   every lambda instance holds up to `connection_limit` connections. On
   serverless a lower limit is the documented guidance, not a higher one.
3. The real fix is Neon's serverless driver via `@prisma/adapter-neon`:
   stateless per-query HTTP, so there is no long-lived pool to go stale.
   It is a data-layer change that needs testing against Neon specifically,
   not against a local Postgres, so it belongs in its own piece of work.

(1) and (2) are `DATABASE_URL` changes on Vercel and need Diego. (3) needs
a branch and a real test against Neon.


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

### Drawing sets, and a guard that had never fired (Cyrus)
`cyrus/drawings`

Sheet 16 closed out. `/drawings` records, per job, which revision of each
set the architect has issued and whether it is actually in the trailer.

**No counter here, unlike every other numbered record in this app.** RFI,
submittal, safety case and material order numbers come from a counter row
we own. "Rev 3", "ASI-12", "Bulletin 5" are the ARCHITECT'S labels,
printed on a title block we don't control — issuing our own number for
someone else's document would invent a second identity for a sheet the
whole job already refers to by its real one.

**Current means most recently ISSUED, not most recently received.** A
revision supersedes the one before it whether or not it has reached you,
which is exactly why an unreceived issue is dangerous rather than merely
pending — the crew is building from paper that is already out of date. The
page counts those separately and says so in red.

**The set is linked, not uploaded.** Server Action bodies cap around 1MB
and real drawing sets are tens of megabytes, so an upload here would pass
for a test file and fail for every real one. The `fileUrl`/`fileName`
columns exist, so a client-side upload can be added later with no
migration. Links are validated to http(s) — the string goes into an
`href`, so a `javascript:` URL would be an injection vector.

### A P2002 guard that never fired anywhere in the app (Cyrus)

Found by clicking, not by any check: recording a duplicate revision label
returned a 500 instead of the plain-language message written for it.

The catch was the codebase's established pattern —
`err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"`.
Instrumented the real runtime rather than guessing:

    DIAG ctor: PrismaClientKnownRequestError
    DIAG code: P2002
    DIAG instanceof: false

The class resolves, the error is the right shape, and the instanceof is
still false — the client's internal error class and the re-exported
`Prisma` namespace are different copies under this bundling. `prisma` and
`Prisma` come from the SAME import, so this is not specific to one file.

**Three existing call sites use the identical pattern and are therefore
also dead:** `company.ts:29`, `jobs.ts:335`, `fieldReports.ts:59`. On
field reports that means the "one report per job per day" message — the
one described in review as turning P2002 into plain language — has never
once been shown; a foreman filing a second report for a day gets a 500.

Fixed with `isUniqueConstraintError()` in `shared.ts`, which checks the
`code` property and so cannot be defeated by class identity. Applied here
and to `fieldReports.ts`. `company.ts` and `jobs.ts` are left alone and
flagged — `jobs.ts` is claimed by the other lane.

The general form, since it will bite again: **an `instanceof` against a
class from a re-exported package is a guess about module identity, not a
check on the value.** Prefer the discriminating property.

### A successful write showed an empty list — cause NOT established (Cyrus)
`cyrus/material-orders`, corrected on `cyrus/drawings`

**This entry originally blamed the connection pool. That was wrong, and
the correction matters more than the original claim.**

What was observed, and still stands: creating a material order returned
ok, the form closed, the row was in the database, and the page rendered
"Nothing on order". A manual reload showed it correctly.

What was asserted and should not have been: that an exhausted pool made
the revalidated re-render query nothing. The pool WAS throwing
`Timed out fetching a new connection` at the time, so the explanation
looked obvious. It doesn't hold. There was no error boundary in the app
then, so a query that threw would have produced a 500, not an empty list.
A ColorZilla browser extension was also injecting a hydration mismatch
into `<body>` in the same repro. Two candidate causes, neither isolated.

The untested hypothesis that fits all three observations — no 500, empty
list, correct after reload — is that the router refresh never fired and
the STALE pre-create render stayed on screen. Falsifiable by watching
whether the RSC refresh request is made at all after a create. Nobody has
done that yet. It is not a claim.

**What IS established is the risk it pointed at**, and that got fixed: a
page that fails after a commit invites a second click, and no create
action was idempotent. 57 create buttons now disable while their form is
in flight, plus an error boundary that says not to resubmit before
reloading.

The lesson worth keeping is not about pools. A plausible cause sitting in
the logs next to a real symptom is not a diagnosis, and writing it up as
one puts a false explanation in the place the next person looks first.

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
