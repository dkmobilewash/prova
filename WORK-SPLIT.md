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
2. **Closeout & Warranty** — Sheet 22. *Shipped 1 Sep.* The closeout
   package's trip to the GC (`closeout.prisma`,
   `lib/actions/closeoutSubmissions.ts`) and readiness derived across the
   checklist, punch items, callbacks and retainage
   (`lib/closeout-readiness.ts`). Reads `PunchListItem`, never writes it.
   Two lines added to `CloseoutJobCard.tsx` (a `packageSlot` prop) and a
   query plus a band on `/closeout/page.tsx`.
3. **Notifications & Alerts** — Sheet 26. *Engine shipped 1 Sep.*
   `lib/alerts.ts`, `lib/alerts-query.ts`, `notifications.prisma`
   (`AlertAcknowledgement` only — alerts themselves are never stored),
   `/alerts`, and a count in `Topbar`. NOT push: four of Sheet 26's rows
   stay Partial on purpose, but no longer for the reason first written
   here. This said "no email sender exists on main", which was true on
   1 Sep and stopped being true when #38 (`cyrus/messaging`) merged: main
   now has `packages/integrations/src/email.ts` (Resend, with
   `readEmailConfig`/`emailSetupProblem` degrading to a named setup
   problem rather than a throw) and `sendOutboundEmail` wired to
   `MessageComposer`. What is still missing is the WIRING: nothing calls
   the sender from an alert, so the rows are Partial for want of a
   trigger, not for want of a transport. Whoever builds it feeds from
   `loadAlerts` rather than growing its own rules, and must decide what
   happens when `emailSetupProblem()` is non-null — a silently dropped
   alert is worse than no alert. Checked against `main` at 21133db;
   `cyrus/notifications` (#59) is building that trigger and had not merged
   at the time of writing, so re-check before relying on this.
4. **Roles & Permissions** — Sheet 25. *Shipped 1 Sep.*
   `permissions.prisma` (`JobFunction`, a nullable column on `User` —
   `UserRole` untouched), `lib/permissions.ts`, `lib/authz.ts`,
   `lib/actions/permissions.ts`, a picker on `/team`. `/jobs/[id]`,
   `/dashboard` and `/contacts/[id]` were left alone at first and then
   done at Diego's request: each computes `showsJobMoney`/`showsBilling`
   once at the top and withholds whole sections. Sheet 25's second row
   stays Partial only because there is no mobile SURFACE.
5. **Multi-state prevailing wage rules** — Sheet 21. *Shipped 1 Sep.*
   `prevailing-wage.prisma` (`PrevailingWageRuleSet`, effective-dated with
   a Postgres exclusion constraint), `lib/prevailing-wage.ts`,
   `lib/prevailing-wage-query.ts`, `lib/actions/prevailingWage.ts`,
   `/prevailing-wage`. Rules only — no wage-rate dataset, nothing seeded,
   blank means unchecked. One additive column on
   `PrevailingWageDetermination` (`ruleSetId`, ON DELETE SET NULL).
6. **Apprentice / fringe remittance reporting** — Sheet 09. *Shipped
   1 Sep.* `CraftClassification.tier` + `apprenticePeriod` (two nullable
   columns, no backfill), `lib/apprentice-ratio.ts`,
   `lib/fringe-remittance.ts`, `lib/union-compliance-query.ts`,
   `lib/actions/unionCompliance.ts`, `/union-compliance`. Also raises the
   apprentice-ratio alert Sheet 26 had listed as blocked. Program
   enrolment tracking is deliberately still Partial — it needs the
   program's own data model and cannot be derived from hours logged.

**All six items in this lane are now shipped and unmerged on the branch.
None has been browser-tested.** That is the outstanding risk, not the
remaining work.

It does NOT touch estimating, billing/AIA pay applications,
`jobs/[id]/page.tsx`, safety, materials/vendors, equipment or RFIs. Where
one of the six genuinely needs a shared file, the change is the smallest
one that works and is called out explicitly rather than restructured —
backcharges needed exactly three such lines: one route in `middleware.ts`,
one entry in `navItems.tsx`, and one `export *` in the actions barrel,
plus the back-relation fields Prisma requires on `Job`, `Company` and
`User`.

## A fourth lane, claimed 2 Sep 2026

A fourth session is running alongside the three above. It owns the
customer-facing CRM, Phase A of the CRM spec, one item at a time on a new
branch per item (previously `claude/prova-crm-contact-lifecycle`, then
`claude/prova-crm-interaction-log`, then `claude/prova-crm-contact-people`,
then `claude/prova-crm-followup-alerts`, now `claude/prova-sales-crm` for
Phase B below):

1. **Contact create/delete + prospect status** — Sheet 02. *Shipped 2 Sep.*
   `ContactStatus` (PROSPECT/ACTIVE/INACTIVE), `ContactType` (GC/DEVELOPER/
   VENDOR/SUBCONTRACTOR, nullable, no backfill), `Contact.msaExpirationDate`
   / `.prequalificationExpiresAt` (both nullable, status derived via
   `lib/compliance-expiry.ts`'s existing `RenewalKind` machinery, not a
   second copy of the day-counting). `createContact`/`deleteContact` added
   to `lib/actions/company.ts`, and `updateContact` converted to the
   `ActionResult` pattern in the same pass. UI: `/contacts` gets a
   collapsed add-form and two-step delete; `/contacts/[id]`'s edit form
   gains status/type/MSA/prequal fields.
2. **Interaction log per contact** — Sheet 02. *Shipped 3 Sep.*
   `ContactInteraction` (new file `crm.prisma`) — call/email/site-visit/
   note, dated (entered, not stamped), with an optional follow-up date and
   a separate follow-up owner (`followUpAssignedToUserId`, distinct from
   `loggedByUserId`). Not an evidence record: no counter, no locked fields,
   any team member can log/edit/delete one. `lib/actions/crm.ts`, gated
   behind `MANAGE_ESTIMATING` on `/contacts/[id]` like Bid Invitations.
   `deleteContact`'s guard extended to also block on logged interactions.
   Not wired into `/alerts` yet — that's item 4.
3. **`ContactPerson`** — Sheet 02. *Shipped 3 Sep.* Individual people at an
   account (name/title/email/phone), new model in `crm.prisma`. No stored
   "last contact" — derived from `ContactInteraction.contactPersonId`
   (new, optional, `SET NULL` on delete) at read time. `deleteContact`'s
   guard extended again to count people as account history.
   `createContactPerson`/`updateContactPerson`/`deleteContactPerson` in
   `lib/actions/crm.ts`; a "People" section on `/contacts/[id]` above
   Interactions, and interactions can now optionally name who they were
   with. No `isDecisionMaker` flag or role-based filter tabs — left out,
   see ARCHITECTURE.md.
4. **Follow-ups surfaced in `/alerts`** — Sheet 02 / Sheet 26. *Shipped
   3 Sep.* No schema at all: `ContactInteraction.followUpOn` already
   existed (item 2). New `CONTACT_FOLLOW_UP` `AlertKind` in the shared
   `lib/alerts.ts`/`lib/alerts-query.ts` (Cyrus's territory, touched
   additively only — a new kind, a new fetch block, nothing existing
   changed), gated behind `MANAGE_ESTIMATING`, horizon fixed at 7 (the
   floor `notification-milestones.ts` requires — see Slack and
   ARCHITECTURE.md for why a lower number silently drops its own earlier
   warning). Rides PR #59's generic dispatch layer for email delivery with
   no changes there. Visible to everyone holding the capability, not
   scoped to the specific assignee, matching every other kind.
5. ~~A read-only GC pipeline view over `BidInvitation`~~ — already shipped
   by another lane as `/pipeline` (PR #80, merged before this lane reached
   it): `lib/bid-pipeline.ts` + `lib/bid-pipeline-query.ts`, reading
   `BidInvitation` per GC, derived and stored nowhere. Struck rather than
   duplicated.

Then Phase B: an internal, owner-only sales CRM for selling Prova itself.
*Shipped 3 Sep.* `SalesLead`/`SalesOpportunity` (new file `sales.prisma`) —
prospective Prova customers and the deals in progress with them, not a
second `Contact` (every tenant has their own GCs; this belongs only to
Prova's own operating company). Gated on two independent checks, neither
expressible as a `lib/permissions.ts` `Capability` (that map is about job
function *within* a company, and an OWNER always holds every capability in
it regardless — there's no way to express "owner only" there): a new
`Company.isProvaOperator` boolean (exactly one row ever true, set by hand)
and `role === "OWNER"`, both checked directly in `lib/actions/sales.ts`'s
`assertSalesAccess` and in `/sales`'s pages. `/sales` (list) and
`/sales/[id]` (lead detail + its opportunities), a new "Internal" nav group
appended only when both checks pass — `navGroupsFor` in `navItems.tsx`
gained an optional second argument for this rather than folding it into
`canReach`'s capability system. `deleteSalesLead` blocks once a lead has
opportunities on file, same reasoning as `deleteContact`.

It does NOT touch estimating, job costing, billing/AIA, retainage, WIP,
AI, `jobs/[id]/page.tsx`, safety, materials/vendors, equipment,
backcharges, closeout, alerts, roles/permissions, prevailing wage, or
union compliance — those stay in the other three lanes. Where a CRM task
genuinely needs a shared file, the change is announced in Slack before the
push and kept to the smallest diff that works, same discipline as the
third lane's backcharges note above.

**Note that this file is otherwise out of date.** It describes a single
`packages/db/prisma/schema.prisma` and a single `apps/web/lib/actions.ts`;
both were split by domain some time ago — the schema into
`packages/db/prisma/schema/*.prisma` and the actions into
`apps/web/lib/actions/*.ts` behind a barrel. New work adds a new file per
domain rather than appending to an existing one, which is also why the
"only add at the very end of the file" advice below no longer applies the
way it reads.

## A fifth lane, claimed 4 Sep 2026

The internal sales CRM again — Phase C, on `claude/prova-contractor-os-e3f0iz`
(the third lane's branch, whose six items are all shipped and merged; the
fourth lane declared its own scope finished in Slack on 2 Sep). Phase B
built the nouns; this lane builds the memory and the read.

**What Phase B actually left.** `SalesLead` and `SalesOpportunity` with
full CRUD, `/sales` (a flat list of leads) and `/sales/[id]` (edit the
lead, list its opportunities). That is a filing cabinet, not a CRM. Three
things a person selling Prova cannot do with it today:

- **Remember a conversation.** There is no activity record at all. The
  entire memory of a deal is `SalesOpportunity.notes`, one mutable
  free-text field that the next edit overwrites. The customer-facing CRM
  solved exactly this with `ContactInteraction`; the internal one has
  nothing equivalent.
- **Be reminded.** No follow-up date exists anywhere, so nothing ever
  says "you said you'd call them Tuesday."
- **See the pipeline.** `/sales` lists leads. To learn what is in `TRIAL`
  you open every lead in turn. There is no count by stage, no MRR total,
  no forecast — despite `estimatedMrr` and `expectedCloseDate` being on
  every opportunity already.

**The three items, in order, one at a time:**

1. **Sales activity log + follow-ups.** *Built 4 Sep, not yet clicked.*
   `SalesActivity` in `sales.prisma` (`20260904005940_add_sales_activity`,
   purely additive), modelled on `ContactInteraction`: type, `occurredOn`
   (entered, not stamped), summary, optional `followUpOn`, optional link to
   the opportunity it was about. An Activity section on `/sales/[id]`, and
   a follow-up queue plus a derived last-contact line on `/sales`.
   Derivation in `lib/sales-activity.ts` — one open follow-up per lead read
   off its LATEST activity, last-contact excluding notes, both computed at
   read time and stored nowhere. Three actions in `lib/actions/sales.ts`,
   plus two Phase B fixes carried in the same pass: the opportunity count
   on `/sales` went stale because create/delete revalidated only
   `/sales/[id]`, and `deleteSalesLead`'s guard did not count activities
   despite `SalesActivity.leadId` being `RESTRICT`.
2. **Stage history.** A `stage` that moves with no record of when leaves
   "how long has this sat in `DEMO_SCHEDULED`" unanswerable, which is the
   most useful number a pipeline has. Recorded on every move; time-in-stage
   derived from it, never stored.
3. **Pipeline by stage.** Counts, MRR and a forecast read across every
   opportunity, the internal analogue of `/pipeline`. Zero schema — it is
   a read over what items 1 and 2 leave behind.

**Follow-ups deliberately do NOT go into `/alerts`.** The customer-facing
CRM's `CONTACT_FOLLOW_UP` was the obvious precedent and it is the wrong
one here. `/alerts` is gated on a `lib/permissions.ts` capability, and the
sales CRM's whole gate is `isProvaOperator` AND `role === "OWNER"` — a
capability cannot express owner-only (see `assertSalesAccess`'s comment).
Routing internal sales follow-ups through the shared alert engine would
therefore show "Follow up with Acme Drywall" to every estimator and PM at
the operator company, which is precisely the gate Phase B built. They
surface on `/sales` instead, behind the same two checks as everything else
in this feature.

**Shared files touched, and this is the whole list:** two back-relation
lines on `Company` and `User` in `company.prisma`, and one back-relation
on `SalesLead`. Nothing else — `/sales` already has its route in
`middleware.ts` and its nav group in `navItems.tsx` from Phase B, and this
lane adds no new route in items 1 and 2. Announced in Slack before the
push, per the agreement.

It does NOT touch estimating, job costing, billing/AIA, retainage, WIP, AI,
`jobs/[id]/page.tsx`, safety, materials/vendors, equipment, backcharges,
closeout, alerts, roles/permissions, prevailing wage, union compliance, or
the customer-facing CRM under `/contacts`.

:warning: **Nobody has ever seen this feature.** `Company.isProvaOperator`
is `false` on every row until somebody flips it by hand — there is no UI
for it, by design — and no Slack message records it ever being flipped. So
Phase B shipped, merged and deployed without a single page load, which is
the "written, documented, and never called" shape CLAUDE.md warns about.
Whoever clicks this lane's work must flip that flag on a test company
first, or every page under `/sales` correctly renders "Not part of your
access" and the click-list passes while proving nothing.


## The bid pipeline view, 3 Sep 2026

The third lane also built `/pipeline` — a per-GC read of `BidInvitation`
(`lib/bid-pipeline.ts`, `lib/bid-pipeline-query.ts`). It is deliberately
READ-ONLY: `BidInvitation`, its actions in `lib/actions/estimating.ts` and
the `/bids` page all stay with estimating, and a status is changed there.
Shared files touched, one line each: `navItems.tsx`, `middleware.ts`, and
the `ROUTE_CAPABILITY` map in `lib/permissions.ts`.

The CRM lane (`claude/prova-crm-contact-lifecycle`, #72) owns contacts
themselves — creation, status, MSA/prequal, and whatever comes next on
`/contacts`. This page links to those pages and edits none of them.

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
