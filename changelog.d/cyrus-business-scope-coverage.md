### The rail hid three routes out of thirty-nine, and it could not tell what a company already had (Cyrus)
`cyrus/business-scope-coverage`

The three onboarding questions on `/welcome` were shaping the sidebar for
exactly three routes — `/submittals`, `/prevailing-wage`, `/union-compliance`
— out of the roughly thirty-nine the rail carries. Two things changed.

**One route joined them, and the audit behind that number is worth more than
the entry.** Every plausible candidate was read as a PAGE and as a PRISMA
MODEL before being judged, and the bar was the one `NAV-IA-AUDIT.md` was
written to enforce: a company that answered this way would never use the
page and would be RELIEVED not to see it, not merely "uses it less". Only
`/backcharges` cleared it, hidden when a company says it never works under a
GC. That is not a guess about the label: `gcReference` is "the GC's own
document number for it", `claimedAmount` is "what the GC says we owe", and
`respondByDate` is "the contractual deadline to object in writing… most
subcontracts state one". Three columns that exist only because there is a GC
above you. An unhappy owner simply withholds; there is no numbered notice to
log and no objection window to beat.

`/rfis`, `/drawings`, `/closeout`, `/proposals`, `/intake` and `/bids` were
each weighed and LEFT VISIBLE, and the reasons are in the map's own comment
so nobody re-derives them. The sharpest is `/closeout`: it looks GC-shaped
because `CloseoutSubmission` has a literal `gcResponse` column, but the page
also holds warranty periods and callbacks — and a contractor working direct
for owners gets those calls straight from the owner rather than filtered
through a GC, so hiding it would have taken away more than it saved. Six
built features were cut from this rail on 3 Sep 2026 and four were restored
eight days later; "deferring a feature and telling a contractor it does not
exist are different acts" is the whole reason this list is short.

**Two: an answer can no longer hide a door to records that already exist.**
A company that spent a year under GCs, logged backcharges, and then answered
"direct for owners" kept losing the menu to disputes it was still inside the
objection window on — the claimed amounts keep counting against the job's
money whether the rail links to them or not, so the figure stayed on screen
with nothing to open. Same for a union shop answering "no public work" while
it still owes the trust funds this month's fringe. The rows now win over the
answers.

`lib/businessScope.ts` stays PURE — no Prisma, no session, no I/O — because
`components/navItems.tsx` runs in the browser and imports it. The rows are
gathered by the caller and handed across as data: `routesHiddenByAnswers()`
(pure) says what the answers WOULD hide, and only if that list is non-empty
does `app/(app)/layout.tsx` ask `lib/businessScopeData.ts` — the one file
that knows a table name. **Most companies pay nothing at all**: every company
that skipped the onboarding prompt, and every company that answered "under
GCs, public work", hides nothing, so no query runs. For the rest it is ONE
statement — four `EXISTS` probes on indexed `companyId`, one round trip, one
pooled connection — added to the `Promise.all` the layout already runs, so it
costs no extra wall-clock latency. Raw SQL rather than four `findFirst`s
precisely because `connection_limit=5` and this layout renders concurrently
with the page beneath it. `React.cache()` and nothing time-based: a TTL would
make restoring the door late by up to the TTL, which is the one failure this
guard exists to prevent. A probe that throws reports every route as having
data, so the rail shows everything rather than hiding a door it could not
check.

**Still display-only, and it gates nothing.** A hidden route renders on a
direct URL, turns up in global search and is explained by Ask, exactly as
before. `routesWithData` un-hides; it cannot un-gate, and a test pins that an
ACCOUNTING member still cannot see `/submittals` however much data is named.

**The specific checks.** `businessScopeData.test.ts` holds the probe list to
the hideable list from BOTH ends — a probe for a route that cannot be hidden
is dead code, a hideable route with no probe is a route the guard silently
cannot protect — and checks every table and column against the Prisma schema
files, so a renamed model fails a build instead of throwing in the shell on
every authenticated page. Per CLAUDE.md's census scars it asserts its own
scope (the schema directory is walked, not listed) and its own size (the model
parse is counted against an expression sharing no regex with it), so a parser
that matches nothing fails by number rather than passing everything
downstream. `businessScopeData.dbtest.ts` proves the statement actually runs,
that `EXISTS` arrives as a real boolean, that a second company's rows never
leak into the answer, and — inserting one row at a time — that the positional
aliases still line up with the routes they were built from. Ten mutations were
run, each verified as APPLIED by file hash and a single-match anchor before its
result was read, and each turned a named test red: removing the `/backcharges`
rule, keying it off the wrong answer, deleting the data guard, having the guard
un-hide everything whenever the list is non-empty, `navGroupsFor` dropping the
list, a probe naming a table that does not exist, a hideable route losing its
probe, the census parser matching nothing, a rule keyed on an href no rail item
has, and the probe losing its company `WHERE` clause.
