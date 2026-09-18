### "Walk me through this page" — a guided tour from the Help button, on the ten pages a new contractor meets first (Cyrus)
`cyrus/walkthroughs`

Cyrus asked for a help button on each page that walks a confused user
through the whole feature. The first real user is a residential GC who has
never seen the app, so every step is written for him: plain words, one to
three sentences, and never a control the page does not have.

It lives in the Help panel that is already in the topbar on every page, as
a yellow "Walk me through this page" button above the ask-a-person form.
A page with no walkthrough — or one whose steps are all hidden for this
person — shows no button at all, never a dead one. After someone finishes
a tour the button says "…again" (remembered per browser only; a blocked or
private-mode storage just means the first wording).

Covered: `/dashboard` (which is also the jobs list and the Estimating
filter — `/jobs` and `/estimating` redirect there), `/jobs/new`,
`/jobs/[id]` (including time entry, and where the phone app's clock in/out
hours land), `/schedule`, `/pipeline`, `/contacts`, `/punch-lists`,
`/field-reports`, `/ask`, `/settings/import`. The other 28 nav pages are
listed in `ROUTES_WITHOUT_WALKTHROUGH` as the next wave's checklist.

The tour only explains. It scrolls each element into view and outlines it
in brand yellow; it never clicks, types, opens or saves anything. The shade
lets clicks through, so "press Import clients" can be done with the tour
open — and which steps are on screen is re-asked every quarter second, so
the steps inside that section then appear and the count moves from "2 of 4"
to "2 of 6". A step whose element is hidden (by role, an empty state, a
closed form) is skipped, so pages carry steps for both their empty and full
states. On a phone (<640px) the card is a sheet along the bottom, and moves
to the top when the element is the last thing on the page and cannot scroll
clear of it. Esc and Done close it; Tab is trapped in the card; arrow keys
step; focus returns to the Help button; motion respects
prefers-reduced-motion.

No dependency added. The tour libraries each bring a stylesheet that fights
the theme tokens and none re-asks visibility per step, which is the one
behaviour this needs; the whole overlay is ~300 lines.

The check: `lib/walkthroughs/walkthroughCensus.test.ts`. Every step's anchor
must be a literal `data-tour="…"` in its route's page or a module that page
imports (followed transitively); no two steps in a route share one; every
registered route is a page; a static sibling like `/jobs/new` never gets
`/jobs/[id]`'s tour; every nav page is covered or listed as uncovered, and
nothing is both. The derived sets are pinned to independent counts — page
files to `git ls-files`, anchor literals to `git grep -o` — so a walk that
stops following imports goes red with a count rather than passing on an
empty set. Twelve mutations were run against it (remove an anchor, point a
step at a missing id, break the import walk, break the page glob, duplicate
an anchor, hide an anchor in a comment, drop a nav route from the list, a
route with no page, an orphan anchor, an expression anchor, an anchor in an
unrendered file, an unregistered static sibling): 12 requested, 12 returned,
12 red.

`data-tour` attributes are the only change in Diego's files
(`jobs/[id]/page.tsx`, `ChangeOrders.tsx`, `DailyFieldReports.tsx`,
`NewJobForm.tsx`, the dashboard), and one attribute on the `AskPanel` form.
No schema change, no migration.
