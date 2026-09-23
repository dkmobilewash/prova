### A brand-new account's empty pages teach instead of shrugging (Cyrus)
`cyrus/rich-empty`

Cyrus walked the app as a brand-new company and called pages like Contacts
and Messages "super blank" and "weak looking". They were: one grey sentence
under a heading, written a different way on each page, with no picture of
what the page becomes and, on most, no way forward from where you stood.

Eighteen nav pages now share one `EmptyState` (`components/EmptyState.tsx`):
what the page is for in a residential contractor's words; the page's real
next step first (its own add button, pressed through its walkthrough
anchor, or "Create a job" where nothing can exist without one); "Ask C
Stream to do it" only where an assistant command actually exists, which
types the sentence into the Ask box and never sends it; "Walk me through
this page"; where the records come from, for pages that fill themselves;
and an EXAMPLE of the page in use. The example is static markup in the page
file — never read from or written to the database — labelled "Example ...
Not your data", dashed, muted, `inert` and `aria-hidden`, so it cannot be
taken for a record or clicked.

The rich state appears only when the company has never had one of the
thing. A filter that happens to match nothing keeps its plain line — RFIs,
punch lists and backcharges gained a company-scoped `count()` to tell the
two apart, since their lists are filtered in the query.

Contacts also got structure once it has data: counts (contacts, with jobs,
open bids), status chips with counts, and "Last in touch" from the latest
logged call or note. Messages' filter chips now carry their counts.

The checks: `emptyStateCensus.test.ts` holds every nav page to the
component or to a named exception with a reason, counts the nav a second
way from `navItems.tsx`'s source and the adopters a second way by `git
grep`, requires each `<EmptyState` to carry a literal `data-tour` anchor,
and requires every "opens" button to name an anchor its page renders. It
also requires `HelpButton` and `AskPanel` to actually listen for the two
events the buttons send. `empty-states.test.ts` renders fourteen of the
pages against an empty database. Eleven source mutations and three page
mutations were each run and each turned a test red.
