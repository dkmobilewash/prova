### The rail's money figures no longer reach people without money permission (Cyrus)
`cyrus/rail-money-gate`

Found by the 2026-09-19 security audit, and it is the audit's one real
finding: the layout loaded the Money Rail's five company-wide dollar
figures — bid pipeline, contract value, unbilled, retainage held — and
passed them to the Sidebar for EVERY principal. The Sidebar is a client
component, so the figures were serialized to the browser even for a FIELD
member, the one job function lib/permissions.ts deliberately strips of all
money. Ten lines below, the same file already gated MetricBar on
VIEW_COMPANY_FINANCIALS with a comment stating the exact principle.

The stages now load only for a principal holding VIEW_COMPANY_FINANCIALS;
everyone else's rail renders its headings and items with no figures and no
Proving row, and the money queries never run for them (a FIELD page render
also gets faster). Pinned two ways, both mutation-checked red: a static
guard in page-money-guards.test.ts (ungated call → red), and a Sidebar
render test that a stages-less rail stays a working nav with no dollar
text.
