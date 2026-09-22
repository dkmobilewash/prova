### Where /pipeline's save time actually goes, counted — and the one part of it this page was wasting (Cyrus)
`cyrus/pipeline-list-refresh`

The complaint was "saving on /pipeline feels slow, the whole page is rebuilt
on the server after every save". The second half is true. The first half is
mostly no longer about the list, and the numbers say why.

**What was already fixed, before this branch.** The chase list already puts
the row on screen the moment you click Save and holds it until the server's
own list arrives — `useOptimistic` plus the held-change machinery in
`components/pursuitListChanges.ts`, and `components/bidPursuitList.test.ts`
covers the refusal, the roll-back and the "saving…" marker in 24 cases. A
second optimistic layer was the obvious thing to build here and it would
have been building it twice. So this branch went looking for the server cost
instead.

**The count, taken 2026-09-22 with a counting Prisma proxy** (client calls,
not SQL statements — a nested relation is one call and more than one
statement), one job seeded so the per-job child reads fire:

| what runs on a /pipeline render | Prisma client calls |
| --- | --- |
| layout: `countVisibleAlerts` (the bell) | 24 |
| layout: `getMoneyRailStages` (the rail) | 14 |
| layout: `loadCompanyFinancials` (the metric bar) | 9 |
| **the page itself** (`loadBidPipeline`, `loadBidPursuits`, `loadLinkableInvitations`) | **3** |

Four of the layout's loaders are `cache()`d and overlap, so a real render is
under 47 — but the shape holds: **the page is roughly a fifteenth of the
work its own save sets off.** A Server Action that calls `revalidatePath`
re-renders the route from the ROOT (CLAUDE.md, issue #61: "action flight is
always a root render"), so adding a pursuit re-runs the alert bell, the
money rail and the metric bar, none of which a pursuit can change. Through a
pooler capped at `connection_limit=5`, ~38 calls is at least eight round
trips of queueing before the first byte — which is the 1.5s issue #61
measured, arriving from a direction that entry did not count.

**What the page was wasting, and this branch fixes.** `loadBidPipeline` read
EVERY contact on the account with every bid invitation nested under it, then
dropped the ones with no invitations in JavaScript twenty lines later. A
sub's contact book is vendors, suppliers, architects and inspectors as well
as GCs; only the GCs can ever reach this page, and the rest were being read
out of Postgres and shipped across the pooler on every page load and every
save. The nested read is the worse half — Prisma resolves `bidInvitations`
as a second query keyed `WHERE "contactId" IN (…)`, so every discarded
contact widened that IN-list too. It is now `where: { companyId,
bidInvitations: { some: {} } }`, and the JavaScript filter stays as belt and
braces, the same way `lib/moneyRail.ts` keeps `isLive`.

**Why the existing dbtest could not catch it**, which is the transferable
part. `bid-pipeline-query.dbtest.ts` already asserts "leaves out a contact
who has never been invited to bid" — and it passed before this change and
passes after, because a post-query filter satisfies it exactly as well as a
where-clause does. The assertion that can only be true of the where-clause is
the ARGUMENT sent to the database. `lib/bid-pipeline-query.test.ts` reads it,
the same shape `bid-pursuits-query.test.ts` uses for the link picker's tenant
boundary.

**And the number above is now a test, not a sentence.**
`lib/pipelineQueryCensus.test.ts` derives the loader list from
`pipeline/page.tsx` itself — not from a list in the test, because CLAUDE.md's
theme-contrast entry is about a census with the right pattern and the wrong
scope — then asserts each loader issues exactly one query, that every query
carries a `companyId`, and that the total is 3. A fourth loader on the page
fails by name until somebody records what it costs; a parse that matches
nothing fails loudly instead of passing an empty set downstream.

Mutation-tested, five of them, each red then green again: drop the
where-clause narrowing; drop `companyId` from it; add a fourth loader to the
page; make a loader issue a second query; make the census regex match
nothing.

**What this does NOT do, said plainly.** It will not make saving feel
noticeably faster. The dominant cost is the layout re-render, it is in the
shared shell rather than on this page, and nothing here could be measured
against real data from an agent container — no production, demo or dev
database is reachable, so every figure above is a count of calls, not a
stopwatch. Payload, measured the same way (serialized props for the client
list): 7 KB at 10 pursuits, 30 KB at 40, 69 KB at 120 — of which the
"Link invite" picker is a flat 11 KB at its `take: 100` ceiling, streamed on
every render whether or not anybody opens it. That is the next thing worth
looking at on this page, and it is a behaviour change that needs clicking.
