### Declutter: see it, then click into it (Cyrus)
`cyrus/declutter`

The density audit (2026-10-13, `prova-ux-reports/density-audit.md`) measured
the app at 1512×706: Crew & time was 9.94 screens tall with every time entry
ever and two open forms, /settings 7.11 with 15 sections and 7 save buttons,
/union-compliance 4.74, /closeout 4.18 with a full four-section card per job.
Five causes, each now one shared piece and one rule:

**Shared pieces.** `CollapsedForm` gained `openOnHash` (the closed button
carries the id, so `crew#log-time` still lands AND opens) and
`tone="secondary"` so a page keeps one yellow primary. `SeeAll` +
`seeAllWindow(?all=1)` is the one line under a capped list, copied from the
photo tab. `Disclosure` is one native `<details>` — `card` / `row` /
`plain`, `name=` for one-open-at-a-time; `row` IS the row-expand pattern.
`PageTabs` is `JobSectionNav` generalised (sub-route or `?tab=` hrefs,
`activeTab()` in a plain module so the server renders by the same rule).
Checks: `CollapsedForm.test.tsx` (hash open in happy-dom), `SeeAll.test.tsx`,
`Disclosure.test.tsx`, `pageTabs.test.tsx`; twelve mutants killed (unconditional
open, dropped listener, dropped id, first-match tabs, dropped param check…).

**Job shell.** The five stage boxes are one compact row; every step still a
link with ✓/!/number and its status. The highlight: Overview now outlines the
job's CURRENT stage (Lakeshore's Overview outlined Contract); Retainage→Billing
and Field reports→Crew were correct filing and are pinned by tests, not
changed. Check: `jobStages.test.ts`, `jobPage.render.test.tsx`.

**Crew & time** 9.94 → ~2 screens: Log time behind its button, this week's
entries under the table, sign-off / T&M / dispatch as collapsed cards with
counts, history capped at 7. **Job Compliance** 3.11 → ~1.3: attach form
collapsed, DAS 140/142 as status-line rows. **Field reports** (both pages)
~3 → ~1.2: one row per report (date · job · N crew · hours · delay · filed
by), latest 7 + See all, delays above the list on the job tab.

**/settings** 7.11 → ~2.5 on five `?tab=` groups; every `/settings#x` link in
the app became `/settings?tab=…#x` because a hash cannot choose a tab
(renewals, phase codes, import, compliance, alerts, the QuickBooks OAuth
redirects). **/union-compliance** 4.74 → ~1.5 on three tabs; each local a
row. **/settings/integrations** H1 said the raw path: `PageHeader` names an
off-area route by its nav label (`PageHeader.test.tsx`).
Check: `section-tabs.test.ts` — each tab renders its group and no other, and
every heading reachable before is reachable in exactly one tab.

**Home**: Needs you + Money directly under the greeting, 4 chips, overdue
once. **Pipeline**: chase list first, the AI lookup behind a button.
**Closeout** 4.18 → ~1: one row per job, blockers said once, not-yet-under-way
jobs behind `?all=1`. **/proposals, /wall-types**: add forms and rows
collapsed (layout only). **/wip**: "In progress" not `IN_PROGRESS`, CSV
button secondary. **/backcharges**: brand yellow, not blue.

**The site-address "bug" was not one.** Riverside's address was the input's
PLACEHOLDER, "123 Main St, Portland, OR 97201", read as data. The placeholder
is now "Street, city, state" and the hint's condition is `siteWeatherNote()`,
tested with a blank address counting as absent.

**Skipped:** /bids (#14) — a 693-line page in Diego's lane, not reached
cleanly. Noted, not started. `estimate/page.tsx:566` still links bare
`/settings` for employer burden; it lands on the Company tab, should be
`?tab=estimating` — Diego's file.

Reachability census and theme-contrast census green on the merged branch;
nothing a user could reach before is unreachable now (tab, disclosure or
See all for each).

**Follow-ups from the after-pass.** `/closeout`'s key warning: the page built
a `<CloseoutPackagePanel>` inside its `.map` and handed it to the card as a
prop, so it reached the card's children with no key; the card now takes the
package's data and builds the panel itself (a test walks the page's tree and
fails on any element prop). The Apprenticeships tab's empty state said "the
ratio review above" — it links to the This month tab now. Job → Field
reports: an empty delay log beside reports tagged Delay (the tag also reads a
report's free-text note) now says "Nothing in the delay log yet — N field
reports mention a delay in their notes" instead of "No delays logged"; the
count is over every report, not the shown window, and no data changed.
Settings → Company: the gap box names each gap and its consequence is said
once, under the field that fixes it — the auto-generated-name sentence was on
the first screen twice. `/pipeline`: the "past the deadline and never sent"
badge is gone; the standing line that names the bid says it once, in red.

**Round 2 — Diego's three pages, layout only (approved 2026-10-14 via
Cyrus).** No figure, Prisma query, server action, form field or status
transition changed on any of them; the diff was read line by line for
exactly that, and every `action=` / `name=` in it is either unchanged or a
`<details name>` accordion group.

**Job → Estimate** (4.31 / 4.44 screens; 61 live inputs, the most of any
page). On a bid the tab opened on the AI text box and every line item was an
open edit form. Each line is now one row (description · qty · unit · unit
price · total) under a Lines total; pressing a row opens the same form, one
at a time (`Disclosure row`). Add line item is the one primary; Add from
catalog and Draft from scope are buttons under the table. The recap's rates
sit behind Edit rates (`BidRecapPanel ratesCollapsed`, default off); wall
schedule and versions collapse with counts; Ready to lock this in? stays
open. On a contracted job each line is a row (contract · actual · % ·
earned) that opens its Log cost and Re-forecast forms; the six WIP tiles and
ChangeOrders are unchanged, so `#change-orders` (HashLanding, ⌘K, Paperwork)
still lands. The burden link opens `/settings?tab=estimating`. Check:
`estimate/declutter.test.tsx` (containment, order, one primary, settings
link; `BidRecapPanel` rendered both ways) — five mutants killed.

**Job → Billing** (3.21 screens) listed every pay application twice, each
copy with its own status select (3 invoices rendered 5 selects). One list
now: a row per invoice ("#N · amount · status · due", overdue red), the
newest open to the full card — Application link, issued date, paid,
balance, the one StatusForm, QuickBooks push, payments, Log a payment. The
second list in `PayApplications.tsx` is gone and the reachability parent for
the pay-application route moved with the link. "QuickBooks isn't connected."
is said once above the list (`shownAbove`, display only — `blocked` still
reads the full blocker list). Create invoice behind a button; the SOV
paragraphs in one closed "How pay applications work"; lien waivers collapse
and open themselves on `#lien-waivers`. Check: `billing/declutter.test.tsx`
renders the real page against mocked data — four mutants killed.

**/bids** showed every bid ever, each row a four-panel mini workspace. The
latest 20 + See all (filters preserved); the count, won value and decline
figures still aggregate every matching bid, because the query is unchanged
and only the rendered list is sliced. Lines, addenda, quotes and the job
link sit behind one row disclosure per bid; `/ai/bids/[id]` does NOT render
those four, so none was dropped. "Work turned down" is one line with a link
to the declined bids. Check: `bids/page.test.ts` (+4) — five mutants killed.
Noted for Diego: `lib/agents/bidWatcher.ts:52` links `/bids#<id>`, which a
bid older than 20 no longer renders; `/ai/bids/<id>` is the right target.

**Round 3 — the rest of the density audit, ranks 11–40 (2026-10-14).** Same
rule, 26 more pages: first screen = what the page is, what needs you, the one
primary action; everything else one click away. Takeoff (#37) was left alone
on purpose — Diego is in it. Every control moved behind a click is listed in
`prova-ux-reports/declutter-results.md` under "Round 3" so the e2e specs can
follow (#774: `CollapsedForm` renders its children only once opened).

**Field & paperwork.** /schedule showed the week twice — the grid, then the
same days as a list: grid at ≥md, list on a phone, the other view one click
away at each width; the gap list is a count that opens; calendar steps
collapse; start dates and unscheduled capped at 5 + See all (sliced in
render, the query is untouched because the form's picker needs every job).
/team: Invite behind its button with the sign-up URL inside, the team-vs-crew
explainer said once, one Crew heading. /rfis, /submittals, /drawings,
/material-orders: job chips by name only; the GC's answer, "Revisions · N",
"Earlier revisions · N" and "Deliveries · N" open per row; Procore/ACC feeds
closed with a count. /punch-lists: job filter first, Add behind its button
(`?new=1` opens it). /safety: "What happened" per incident, talks latest 10 +
See all (replacing a silent `take: 50`). /equipment: two lines per piece with
every action on the row. /photos: filter chips wait for a photo. Job → Crew
and Compliance on an EMPTY estimate are one line with a way in (`?open=1`),
like Billing; a public-works bid keeps its full Compliance tab, and nothing
with a record is ever shortened.

**Compliance, AI, alerts.** /alerts: explainer in a disclosure, Email-me in
the header, the banner that restated the heading gone, Snooze/Seen under
hover with a mouse and always there on touch and focus; the list stays
uncapped — it IS the See-all page. /ai/activity: Settings on `?tab=settings`
(the `#cap` / `#agent-switches` links follow), consecutive same-kind events
folded ("New invitation × 10"), 50 rows + See all — display slice only, the
queries unchanged. /ai rail: a finding is one line that opens, capped at 5
at the render (the page already asks for 5; the audit's "14" was the count
badge); Running now is "N running · N recent" and opens itself when a run
needs a hand. /prevailing-wage: "Check a week" first, one row per worker
("matches" via the same `reviewIsClean`), rules and the job mapping on
`?tab=setup`. /compliance: EMR one status line, documents one row each.
/lien-deadlines: the paragraph said once, tiles → `StatusLine`
(`lienDeadlinesStatus`), waivers one line of job links. /certifications:
START HERE one closed disclosure while nothing is set up, one row per person,
By job as `?view=job`. /messages: one setup warning, no banner.

**Money & catalog — Diego's lane, layout only.** Read line by line: no
figure, Prisma query, server action, field name/default or `action=` changed;
blocks were wrapped, moved or re-indented. /cash-flow: forecast first, the
WIP CSV a header link with its paragraph in a disclosure, the overdue total
stated only when more than one bucket holds money (same `totalOutstanding`).
/catalog: Add and Import on top, entries a table with actuals/quotes/owner
forms per row, templates behind "Estimate templates · N". /vendors/pricing:
one row per item, the unit rule said once. /backcharges: tiles →
`backchargesStatus`, rows that open (and open themselves on `#<id>`). /wip:
eight key columns fit one screen, the eleven breakdown columns at
`?detail=1`, over/under definitions as hints on the headings. /phase-codes:
empty state is the heading and button. Job → Retainage: totals, releases,
then Log release behind a button, then "10% · expected substantial
completion …" with Edit holding the unchanged form (`retainage-single-source`
green). Job Overview, three spots only and no section moved: details as a
read-only list with Edit details, Upload subcontract behind a button, "how to
mark contracted" said once (the header's Won it? box). `HintedText` is the one
new piece — a focusable label with a `<Hint>` for server pages, since `Hint`
is client-only.

**Round 2 leftovers from the after-pass.** The burden sentence's double full
stop; the Save in an opened estimate row at 44px; `CollapsedForm`'s closed
button wrapped so a flex column cannot stretch it (Billing's Create invoice
ran full width beside Submit pay application); /bids rows with nothing in
them say "Add lines, addenda, quotes or link the job" instead of a string of
zeros; "1 bid declined, with no reason recorded." in the singular.

Check: one `declutter` test per page (31 new or extended files), each with
its mutants recorded in the results file; reachability, theme-contrast,
ciNodeApis, walkthrough, row-actions and retainage-single-source censuses
green on the merged branch.

**The e2e specs, made to press what the declutter put one click down.**
`CollapsedForm` renders nothing inside until it is pressed, so a spec that
filled a field inside one waited forever — a timeout, not an assertion
failure (#774: the proposals step of `estimating-spine` and
`wage-rates.spec.ts`). Fixed in the specs, never with `startOpen`: two helpers
in `e2e/lib/collapsed.ts` — `openCollapsed(scope, opener, revealed)` presses a
client opener and retries until what it hides is on screen (a press before
hydration does nothing; the opener and the submit often share words, so the
reveal is what is checked), and `openDisclosure(details)` opens a native row by
its group name (`details[name="bid"]`, `"estimate-line"`, `"cost-line"`,
`"proposal-clause"`), because `getByRole` skips what a closed `<details>` hides.
`submitInvoice` opens "Create invoice" itself; bid rows reopen after every
reload so read-backs are read on screen; job-detail's Billing tab checks the
"Submit pay application" button where the deleted "Pay applications" heading
was. Nothing could be run in a browser here. Check: `e2e/lib/collapsed.test.ts`
fails in a second when a pressed opener or opened row name no longer exists in
the app, and counts its parse independently — mutation-checked both ways.

**The e2e specs, again, for round 3.** Same rule — press what a person
presses, never `startOpen`. Retainage terms are one line with an "Edit"
(`openRetainageTerms` in `e2e/lib/journey.ts`, scoped to the terms line) before
every fill and every read-back after a reload, in `journey`, `known-bad-inputs`
and `shoot-rehearsal`. The job Overview's details open on "Edit details", and
/catalog's templates are `details#templates`, in `estimating-spine`. Every spec
that finds the seeded job on /schedule now loads `/schedule?all=1`: the job
lists show 5 each and the seeded job is the oldest on the account. And
`shoot-rehearsal` counted "Total outstanding" as TWO on /cash-flow; round 3
prints the aging total only when two buckets hold money, and that company has
one invoice, so it is an exact ONE now (still read inside its own section).
Nothing could be run in a browser here. Check: `collapsed.test.ts` now also
pins every `details#id` a spec opens to an `id="…"` in the app, with its own
independent count — mutation-checked.

**Final pass.** /catalog's column header drifted right of its values and ran
"Cost" into "Trade": the header and rows shared the column template but only
the rows carried the gap. `CATALOG_ROW_GRID` is now the whole grid, gap
included, and both use it unchanged. /wip wears the shared PageHeader (Home /
Money / Work in progress) and says what a "—" means in one sentence instead of
"— is not zero. Not zero — …". /certifications' empty state names the closed
"Start here" section it points at. /safety renders the latest 10 incidents and
/alerts the first 15 (worst first, so SeeAll gained `order="first"`), each with
See all — the status line, heading count and breakdown are still read off every
row. /team and /vendors/pricing open with one line and keep the rest in a
Disclosure. The job Overview's schedule shows the current dates as one line,
with the form behind "Edit dates" — wrapped in place in `(tabs)/page.tsx`, its
fields unchanged. No e2e spec reads any of these. Checks: catalog/declutter,
wip/declutter, certifications/setup-first, safety-declutter, alerts/declutter,
empty-states (/team), vendors/pricing/declutter and schedule-visibility each
fail with their fix reverted.
