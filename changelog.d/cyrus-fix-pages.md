### The first click out of Home no longer lands in a different app (Cyrus)
`cyrus/fix-pages`

The six area pages, the home page and the job header had the Concept G look;
every list page they linked to still had the old one — a 768–896px centred
column, a 20px bold title, no way back but the browser button. The expert
review called it "a beautiful lobby onto thirty old rooms" and ranked it
the top consistency defect (COMBINED.md #8, heuristic F1).

The fifteen list pages the areas link to first now sit in
`PageShell width="working"` with one shared header,
`components/PageHeader.tsx`: a breadcrumb `Home / <Area> / <Page>` derived
from `lib/areas.ts` (so the crumb and the card that opened the page cannot
disagree on a name), the 32px headline and a one-line standfirst. RFIs,
Submittals, Drawings, Field reports, Site photos, Compliance, Safety,
Material orders, Equipment, Schedule, Cash flow, Backcharges, Team, Bids,
Contacts. Three breadcrumb conventions existed on the new pages; this is
now the one, and the area page itself renders the same component.

Presentation only. No server action, query, figure or form internal
changed; the Diego-lane pages (cash flow, bids) took the shell and header
and nothing below them. One form that rendered OPEN — the compliance
document upload — now starts collapsed behind a button like every other
list page, with a test that fails if it opens by default.

Waiting-table rows that are one record now open that record. "Open →" on
an RFI, submittal, material order, lien deadline or invited bid used to
land on the job-filtered LIST and leave you to find the row (heuristic F11).
The href keeps its `?job=` filter and adds `#rfi-<id>` (and the submittal,
order and lien equivalents); the row carries the matching `id`,
`scroll-mt-24` so the top bar does not cover it, and a `target:` ring.
`lib/areas-data.test.ts` holds the href and the row's `id` together so they
cannot drift apart; reverting either side turns it red.

The check: `lib/pageWidthCensus.test.ts`'s allowance list is 33, down from
48. A converted page left on it fails the build; so does a page that goes
back to deciding its own width.
