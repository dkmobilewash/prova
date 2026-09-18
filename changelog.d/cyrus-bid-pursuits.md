### What have we got out chasing — a pre-bid pursuit list on /pipeline (Cyrus)
`cyrus/bid-pursuits`

*"What have we got out chasing that we haven't bid yet?"* was one of the
hundred-question census's gaps, and it was a real one: nothing modelled a
sub's own pipeline BEFORE the invitation. `BidInvitation` starts when a GC
asks us to price something; everything before that — the hospital the owner
announced, the architect we have been talking to, the GC we expect to hear
from — lived in somebody's head.

**The trap this deliberately did not fall into.** `SalesLead`,
`SalesOpportunity` and `/sales` look exactly like the answer. They are not:
`sales.prisma`'s first line says they are Prova's OWN CRM for selling this
product, populated only on the operator company. A tool over them would hand
every tenant the vendor's sales pipeline. Nothing in this change reads them,
and two tests hold that still: `handlers.bidPursuits.test.ts` proxies the
Prisma client and fails if the handler so much as asks for a `sales*` model,
and a source scan fails if the actions, the query module or the component
name one in code.

**`BidPursuit`, one new table, company-scoped rather than job-scoped** —
there is no job yet, and most pursuits never become one. Project name,
owner/developer, architect, expected GC(s) as FREE TEXT (a pursuit often has
no GC yet, or three candidates; a required Contact would force somebody to
create a GC record for a company that may never invite us), an ENTERED
expected bid date, an optional rough value, a stage (watching, contacted,
expecting invite, invited, dropped), a note, and an optional link to the
`BidInvitation` it became.

**Nothing derived is stored.** "Gone quiet" is no edit in 30 days, read off
`updatedAt`; "bid date soon" and "bid date passed with no invite" are the
expected date against today. All three are computed on every read by
`lib/bid-pursuits.ts`, which the page and the Ask tool both use through one
query, so the screen and the answer cannot disagree.

**The stage and the link cannot disagree either.** Linking an invitation
moves the stage to INVITED in the same write, because linking IS somebody
saying the invite arrived. Moving a linked pursuit off INVITED is refused
with a sentence — unlink first. Unlinking leaves the stage alone, because an
invite that arrived by phone and was never logged is exactly what
INVITED-with-no-link means. The link is `@unique` (one invitation came from
one pursuit) and the collision comes back as words via
`isUniqueConstraintError`, not `instanceof`, which is false at runtime here.

**Why /pipeline and not /bids, and not a new route.** `/bids` is titled *Bid
history*: it filters invitations by trade and outcome to answer "what did
similar work price at". A pursuit has no GC invitation, no trade outcome and
no bid amount, so putting it there would muddy the one question that page
answers. `/pipeline` is the forward-looking page — "who invites us and what
comes of it" — and a pursuit is literally the head of that pipeline. Same
gate, `MANAGE_ESTIMATING`. No new route means no `navItems.tsx`, no
`middleware.ts` and no `ROUTE_CAPABILITY` change. The page's intro used to
say "nothing here is stored separately"; that is now true of the invitation
figures only and it says so. `/pipeline` was read-only by design
(WORK-SPLIT.md); it now has one write surface, and it writes only
`BidPursuit`.

**The Ask box can answer it.** `bid_pursuits` — by stage, bid dates in the
next 30 days, dates passed with no invite, pursuits gone quiet, and summary
counts over every row. Its description says it is the company's OWN list and
knows nothing about a project until somebody types it in, so an empty list
is never read as "nothing out there". `q-pipeline` moved from a gap to a
route (`CENSUS_GAPS` 6 -> 5), and the "our own sales pipeline" entry is GONE
from `KNOWN_GAPS` — that list is injected into the system prompt, and left
in it would have told the model to refuse a question it can now answer. A
test fails if a pipeline entry comes back. The five writes are excluded from
the command registry per action, with reasons; the read ships now.

**Migration** `20260918120000_add_bid_pursuits`: additive only — one enum,
one table, three indexes, three foreign keys, every statement on one line.
No backfill: nothing recorded what anyone was chasing, and SalesLead is not
a source. **No #227 cleanup edits are needed**, and why: the table has no
`jobId` and no `contactId`; `bidInvitationId` and `createdByUserId` are SET
NULL; `companyId` is RESTRICT like every company-scoped table, and neither
cleanup script deletes a Company. `scratch-cleanup-order.test.ts` passes
unchanged.

**The capability-guard walk found the actions on the day they were added**,
which is that suite doing its job: it derived all five from `/pipeline`'s
gate, refused to accept `can(user, …)` as the guard shape, and executed each
as a FIELD member. Fixed to `can(context, "MANAGE_ESTIMATING")` with the
shared "isn't part of your job function" refusal; `bidPursuits` added to its
import map.

**Mutation-tested, 20 of 20 red** — each key line broken in turn, the named
test failing, then restored: open-stage set, the 30-day quiet boundary, the
coming-up floor, "today is not passed", value summed over open only, undated
sorting last, company scoping in the query, the stage filter, OPEN's stage
set, a stray `salesLead` read, the KNOWN_GAPS entry restored, the tool's
capability, the create guard, delete's owner check, link setting INVITED,
the unique-collision sentence, the linked-stage guard, delete's company
scope, cross-company invitation linking, and `CENSUS_GAPS`. One mutation
survived the first pass — delete's owner check — and got its own action
test before this shipped.

## The 21st mutation, which review found and the branch did not

The branch reported 20 of 20 mutations caught. An independent pass found a
21st that survived **every** test in the repo: deleting `companyId` from
`loadLinkableInvitations` — the picker of invitations a pursuit can be linked
to — passed all 3,823. The link *action* refuses a foreign invitation, so the
leak could never have written a row; but the picker would have **listed
another company's bids**, project names, GCs and due dates, in a dropdown on
`/pipeline`. `lib/bid-pursuits-query.test.ts` now asserts both the argument
sent to the database and, against a fake that honours the where clause across
two companies, that nothing foreign comes back. Both assertions go red on the
mutation.

The general point, and why an agent's "20 of 20" is not the end of review: a
mutation list written by the author tests the lines the author was thinking
about. The query nobody thought of as a boundary is the one worth breaking.
