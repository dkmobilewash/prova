# Changelog

What actually changed, in plain English, newest first.

**Rule: update this in the same PR as the work.** A changelog maintained
separately from the code drifts away from it within a week — the same way
FEATURE-AUDIT.md on `main` currently claims five features that aren't on
`main`. If a PR changes behaviour, it edits this file too.

Entries say what changed and why it mattered, not which functions moved.
`git log` already covers the functions.

---

## 2026-08-26

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
