### Global search: one box for records and pages, gated the same way navigation is (Cyrus)
`cyrus/global-search`

The founder's worry, after walking the app with Diego: a small contractor
opens the sidebar at ~26 feature areas and concludes "this is for bigger
companies than me." The fix is to hide what a given contractor does not
need — and hiding is only safe if anything hidden can still be found by
typing its name. This is that safety net, not a nice-to-have list view.

**One control, everywhere.** A search button in the topbar (left of Ask,
first in the chrome — see `Topbar.tsx`'s own comment on why it moved
ahead) and the platform-conventional `⌘K`/`Ctrl+K`, both wired in
`SearchLauncher.tsx`. Debounced, keyboard-navigable (arrows, Enter),
grouped by kind, capped at phone width the same way `AskLauncher`'s panel
already is.

**Two kinds of result, and reusing rather than re-describing.** Records —
jobs, contacts, RFIs, submittals, punch list items, drawings, change
orders, invoices, vendors, team members — come from ten new providers in
`lib/search/providers.ts`. Pages come from `lib/ask/appHelp.ts`'s
`reachableWalkthroughs`/`searchAppHelp`, the exact machinery `app_help`
already uses — no second index of what every page does.

**The whole job was never leaking a result to someone who could not
navigate to it,** and that is architectural, not a filter bolted on
after. A provider never declares its own capability — there is no such
field on the type. A provider with a static list page (`/rfis`,
`/punch-lists`, …) derives its gate from `capabilityForRoute()` in
`lib/permissions.ts`, the exact function `reachableWalkthroughs` already
uses for pages. A provider with no static page — change orders and
invoices, both job-detail sections — borrows the capability already
reviewed for the Ask tool that reads the same data
(`change_order_status` → `VIEW_JOB_COSTS`, `pay_application_status` →
`MANAGE_BILLING`), never a fresh decision. `globalSearch` filters
providers by capability BEFORE calling any of them — a gated provider's
`search()` is never invoked for a role lacking it, proven with a spy in
`query.test.ts`, not merely filtered from the response.

**`searchProviderCensus.test.ts`** is the guard the ask named explicitly:
it fails when a new record type ships without a real, derived gate. Five
checks — registry completeness (independently counted, `git`-grep style,
against `providers.ts`'s own `gate:` literals, not against the array it
is checking), unique well-formed types, route-gated providers pointing at
routes that are real pages on disk (a typo would otherwise silently read
as "open"), tool-gated providers citing tools that exist, and the actual
security check: every provider's capability, resolved through the same
function `globalSearch` calls, matched against an independently
hand-reasoned expectation table, with every open provider carrying a
written reason. **Mutation-tested, 5 requested and 5 caught**: unregistering
a provider, weakening a route, a typo'd route, a dead tool citation, and a
missing open-reason — each broke exactly the intended test, never a
different one, and all five restore clean.

**What is searchable and what is not, stated rather than guessed.** In:
jobs, contacts, team (from `User`, not `CrewMember` — see below), vendors,
RFIs, submittals, punch list items, drawings, change orders, invoices.
Out, for now: `CrewMember` (carries the last four digits of an SSN; "Crew"
searches `User` instead — name, email, job function, the same slice
`/team` already shows everyone); anything payroll or compliance-document
shaped; the sales CRM (`isProvaOperator && OWNER`, not expressible as a
`Capability` at all). Each is a decision recorded in `providers.ts`'s own
file comment, not silently missing.

**Tenancy** is a real Postgres test per provider type
(`providers.dbtest.ts`, not run locally — no scratch Postgres in this
session) — two companies, one query that would hit both if a `where`
dropped its `companyId` (or, for change orders and invoices, its
`job.companyId` join), asserting only the caller's own rows come back.

No schema change. No migration.
