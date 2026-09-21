### Safety and Material orders are on the sidebar again, and a greyed-out link can no longer point at a working page (Cyrus)
`cyrus/nav-restore-safety`

Signing in as a new owner and expanding every nav group, Compliance &
safety held Prevailing wage, Union & fringe, Certifications and Team —
no Safety. Logistics held Vendors, Vendor pricing and Equipment — no
Material orders. Both pages are fully built. `/safety` renders the
incident log with its year selector, "Record an incident", "Log a
toolbox talk" and the empty-state line about a first-aid case that later
turns into lost time only being defensible if it was written down the day
it happened.

Two entries in `navItems.tsx` carried `disabled: true`, which both the
rail and the mobile drawer render as a muted, unfocusable span with a
"coming soon" tooltip. That was a deliberate call on 3 Sep
(`NAV-IA-AUDIT.md` rows 6 and 7) — a product-scope deferral, not the
rail-crowding one that addendum 1 retired for RFIs, Submittals, Drawings
and Closeout. Worth stating plainly, because the tempting summary is that
addendum 1 already covered these two and it does not.

What ended it: Cyrus, who granted the override, asked for both back — a
union sub has OSHA 300 obligations and contractors were signing in to
test that day. And the app had started arguing with itself in a way
nobody could have weighed on 3 Sep, because both surfaces shipped after
it. Ask answers "one of my guys cut his hand on site this morning" with a
citation to `/safety` (`lib/ask/handlers.ts`), and global search (#386)
finds the page. The rail was the only surface still calling it unbuilt.
Deferring a feature and telling a contractor it does not exist are
different acts, and only the first was decided.

**The check**, because nothing pinned this and that is why it lasted
eighteen days: `navDisabledCensus.test.ts` fails the build when a nav
entry is marked `disabled: true` while a page file exists for its href.
`disabled` now means one thing only — the route is not built yet.

It derives a route set by walking the app directory, which is the shape
CLAUDE.md has two scars from, so the set is asserted at both ends against
sources that cannot drift with the walk: parsed routes must equal the raw
page-file count (size), and every `NAV_ITEMS`/`NAV_FOOTER` href must
resolve inside it (scope). Mutation-tested three ways, and the middle row
is the one worth keeping:

| | flag | walk | result |
| --- | --- | --- | --- |
| M1 | `disabled: true` restored | correct | RED — names "Safety (/safety, in Compliance & safety)" |
| M2 | `disabled: true` restored | mis-rooted | main guard **vacuously GREEN**; scope + size tests RED |
| M3 | correct | parser collides routes | size test RED alone — "parsed 67 routes from 70 page files" |

M2 is the contrast-census scar reproduced on purpose: the guard cannot
see an offender outside the directory it walks, so the walk itself has to
be the thing under test.

Nav change is two lines, both in `NAV_GROUPS` — `{ ...item("/safety"),
disabled: true }` and the same for `/material-orders` become plain
`item(...)` calls. No route, model, action, permission or group order
changed; `ROUTE_CAPABILITY` still gates both on `MANAGE_FIELD`, and
neither page was ever hidden by business scope.
