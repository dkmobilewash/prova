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
