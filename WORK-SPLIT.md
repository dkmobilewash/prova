# Work split — Diego & Cyrus

Goal: touch mostly different files so we're not fighting over the same
lines every day.

## The two lanes

**Diego's lane — the core estimating/costing/AI engine.** This is the
stuff that's already deep and interconnected: `lib/actions.ts`'s
estimating and job-costing functions, `lib/wip.ts`, `lib/
gc-reliability.ts`, `packages/integrations/src/anthropic.ts`, and the
`apps/web/app/(app)/jobs/[id]/page.tsx` page. Also anything touching
billing/AIA pay applications and retainage next, since those extend the
existing `Invoice`/`Payment` models Diego's been building on.

**Cyrus's lane — new, self-contained feature verticals.** Greenfield
areas: nothing existing depends on them, so there's very little to
collide with. Concretely: Safety & Field Operations, Materials & Vendor
Management, Equipment & Tool Tracking, Closeout & Warranty (punch
lists). Every one of these follows the exact same recipe already used
five times in this codebase (compliance documents, the line-item
catalog, bid invitations, GC contract terms) — a new Prisma model, a new
page under `app/(app)/<name>/page.tsx`, a handful of new functions
appended to the end of `lib/actions.ts`. Copy `app/(app)/catalog/
page.tsx` as your template for any list-plus-create-form page.

**Shared files — be careful here:**
- `packages/db/prisma/schema.prisma` — every new model gets added here.
  `git pull` right before you edit it, and add your model as a pure
  addition (new block at the bottom of the relevant section) rather than
  restructuring anything existing, so two people's changes merge cleanly.
- `apps/web/lib/actions.ts` — same idea. Only add new exported functions
  at the very end of the file. Never modify a function the other person
  wrote without pinging them first.
- `apps/web/middleware.ts` — a one-line addition per new protected route.
  Low collision risk, but check `git pull` before editing since it's a
  short file where two additions on the same line would conflict.

## A third lane, claimed 1 Sep 2026

A third session is running alongside the two above, on
`claude/prova-contractor-os-e3f0iz`. It owns the following, in this order,
one at a time:

1. **Backcharges & Deductions** — Sheet 13. *Shipped 1 Sep.*
   `/backcharges`, `backcharges.prisma`, `lib/actions/backcharges.ts`,
   `lib/backcharges.ts`.
2. **Closeout & Warranty** — the remaining gaps in Sheet 22.
3. **Notifications & Alerts** — Sheet 26, where two items are Partial
   ("it reaches someone who opens the app") and three are Missing.
4. **Roles & Permissions** — Sheet 25, still `OWNER`/`MEMBER` only.
5. **Multi-state prevailing wage rules** — Sheet 21.
6. **Apprentice / fringe remittance reporting** — Sheet 09.

It does NOT touch estimating, billing/AIA pay applications,
`jobs/[id]/page.tsx`, safety, materials/vendors, equipment or RFIs. Where
one of the six genuinely needs a shared file, the change is the smallest
one that works and is called out explicitly rather than restructured —
backcharges needed exactly three such lines: one route in `middleware.ts`,
one entry in `navItems.tsx`, and one `export *` in the actions barrel,
plus the back-relation fields Prisma requires on `Job`, `Company` and
`User`.

**Note that this file is otherwise out of date.** It describes a single
`packages/db/prisma/schema.prisma` and a single `apps/web/lib/actions.ts`;
both were split by domain some time ago — the schema into
`packages/db/prisma/schema/*.prisma` and the actions into
`apps/web/lib/actions/*.ts` behind a barrel. New work adds a new file per
domain rather than appending to an existing one, which is also why the
"only add at the very end of the file" advice below no longer applies the
way it reads.

## Cyrus's first five tasks

**1. (Do this first — should take under an hour.) Add a "Trailer" location
type.**
*What:* `CompanyLocation` currently supports `HQ`, `BRANCH_YARD`, and
`WAREHOUSE` as location types. Add `TRAILER` (a job-site field office) as
a fourth option.
*Why it matters:* It's small on purpose — this is your "does my whole
setup actually work" task, not a real feature. You'll touch the schema,
run a migration, update a dropdown, and open a PR — the full loop you'll
repeat for everything after this.
*Files to open:* `packages/db/prisma/schema.prisma` (find `enum
LocationType`, add `TRAILER`), then run `pnpm --filter @prova/db exec
prisma migrate dev --name add_trailer_location_type`. Then find where
`LOCATION_TYPE_OPTIONS` is defined in `apps/web/app/(app)/settings/
page.tsx` and add a `{ value: "TRAILER", label: "Trailer" }` entry.
*Done looks like:* you can go to `/settings`, pick "Trailer" from the
location type dropdown, save a new company location, and see it in the
list. `pnpm typecheck && pnpm lint` both pass. PR opened into `main`.

**2. Vendor/supplier directory.**
*What:* A new page listing vendors/suppliers (name, trade, contact info,
notes) — no job-linking yet, just a directory, closing part of the
"Materials & Vendor Management" gap.
*Why it matters:* Right now there's nowhere to record who your steel
supplier or drywall board vendor even is — every material cost is just a
dollar amount with no source attached.
*Files to open:* Add a `Vendor` model to `schema.prisma` (companyId,
name, tradeScope, contactName, phone, email, notes — model it after
`Contact`). New page at `app/(app)/vendors/page.tsx` (copy `app/(app)/
catalog/page.tsx`'s list + create-form structure). New `createVendor` /
`deleteVendor` functions at the end of `lib/actions.ts`. Add `/vendors`
to the sidebar (`components/Sidebar.tsx`) and to `middleware.ts`.
*Done looks like:* `/vendors` lists and lets you add/delete vendors,
scoped to your company like every other list page.

**3. Daily field reports.**
*What:* A simple per-job log: date, crew present, work performed,
weather, delays — one row per day, viewable on the job page.
*Why it matters:* First piece of "Safety & Field Operations." PMs
currently have nowhere to record what actually happened on site each
day.
*Files to open:* New `DailyFieldReport` model (jobId, date, crewNotes,
weather, delays, createdByUserId). A new section on `app/(app)/jobs/[id]/
page.tsx` (a small addition near the bottom — check with Diego before
editing this file, since it's in his lane; a short, additive new
`<section>` at the end should be low-risk, but flag it). New
`createDailyFieldReport` action.
*Done looks like:* on a job page, you can log a daily report and see a
list of past ones for that job.

**4. Equipment inventory + job assignment.**
*What:* A company-wide list of owned equipment (scaffolding, lifts,
mixers), and a way to mark which job it's currently assigned to.
*Why it matters:* Feeds into job costing eventually (equipment has a
cost too), but step one is just knowing what you own and where it is.
*Files to open:* New `Equipment` model (companyId, name, type, currently
assigned `jobId` nullable). New `/equipment` page (same list+form
pattern as `/vendors`). New actions for create/assign/unassign.
*Done looks like:* `/equipment` lists all equipment and which job (if
any) each item is currently assigned to; you can reassign it.

**5. Punch lists.**
*What:* A per-job checklist of outstanding items before closeout —
description, done/not-done, who found it.
*Why it matters:* Closes the "Closeout & Warranty" gap — right now a job
just goes from `IN_PROGRESS` to `COMPLETE` with nothing tracking what's
left to fix first.
*Files to open:* New `PunchListItem` model (jobId, description, isDone,
createdAt). New section on the job page (same caution as task 3 — check
with Diego first) listing items with a checkbox to mark done, plus an add
form.
*Done looks like:* on a job page, you can add punch list items and check
them off; the list persists.

## Git rules

- **Branch per task.** Name yours `cyrus/short-name` (e.g.
  `cyrus/trailer-location-type`); Diego's are `diego/short-name`.
- **Pull before you start.** `git checkout main && git pull` before
  branching off, every time — don't build on a stale `main`.
- **PR into `main`.** Never commit straight to `main`, even for a
  one-line fix. Open the PR, and either of us reviews the other's before
  merging.
- **Stay in your lane.** If a task needs you to touch a file in the
  other person's lane (like task 3 or 5 above touching
  `jobs/[id]/page.tsx`), say so *before* you start editing it, not after
  you've already made changes — a two-line Slack/text message avoids a
  painful merge conflict later.
