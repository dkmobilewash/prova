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
