### Every page has a way in, and the pages the sidebar reaches look like the new app (Cyrus)
`cyrus/restore-nav-pages`

Concept G (#748) took the sidebar and the job tab row away. Nothing was
deleted, but about half the app had no visible door — ⌘K or the avatar's
"All pages" only — and no test asked whether a person could get to a page.

`lib/reachabilityCensus.test.ts` asks now. It walks every `page.tsx` under
`app/(app)` and fails unless each route is in the sidebar
(`navGroupsFor` + `NAV_FOOTER`), on an area page, in the top bar, in the job
tab row (`JOB_TAB_ROUTES`), or on `REACHED_FROM` — and every `REACHED_FROM`
entry names the parent file that links to it, which the test greps (comments
stripped), so a reason that stops being true fails. It asserts its own size
(walk ≥ 70, equal to an independent `fs.globSync`, and every git-tracked page
seen) and is a ratchet both ways: an allow-list entry for a page that is gone,
or that is already reachable another way, fails.

28 of the 29 old-style pages in the signed-in shell moved to `PageShell` +
`PageHeader` (`UNCONVERTED_PAGES` 33 → 5), and five already-shelled list pages
that still had a bare `<h1>` got the header too. A new check in
`pageWidthCensus.test.ts` keeps it that way: a page on the shell without
`PageHeader` fails unless it is on a named, reasoned exemption list.
`PageHeader` gained `parent` so a page that hangs off another reads
Home / Settings / Integrations or Home / Jobs & bids / <job> / Form WH-347.
The printable documents (WH-347, certified payroll, pay application, fringe
remittance) print exactly what they printed before; `/jobs/[id]/photo-report`
was left alone because its photos are centred with a content cap the width
census cannot tell from a container. The price book's always-open add form
is behind a button now (`CollapsedForm`).

Check: on any page in the sidebar, the breadcrumb reads Home / <area> / <page>
and every button the page had is still there.
