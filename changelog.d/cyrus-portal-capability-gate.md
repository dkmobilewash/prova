### Anyone on the payroll could hand a GC a login. Now two job functions can, and the button is gone for everybody else (Cyrus)
`cyrus/portal-capability-gate`

`Contact.portalToken` is a bearer credential. Whoever holds the string IS
the GC on `/portal/<token>` — no password, no expiry, no rotation — and
that page shows the contract line items and total, the change orders, and
every invoice with its payments and its retainage-adjusted balance.

`enablePortalAccess` and `revokeClientPortalAccess` called
`requireCompanyContext()`, checked that the contact belonged to the
company, and stopped. No capability check of any kind. So any
authenticated member — a FIELD crew member on a phone in a jobsite
trailer included — could POST to a stable Server Action id and mint one.
This app already knew that field was a credential: #527 exports
`portalRevokedAt` from the contact CSV and deliberately keeps
`portalToken` in `EXPORT_WITHHELD` **because it is a bearer credential**.
We withheld the string from the customer's own download while letting
anyone on the payroll issue one, which is the first question a GC's IT
person asks.

**MANAGE_BILLING, derived rather than picked.** The capability is read off
what the link OPENS, and what it opens is `MANAGE_BILLING`'s own doc
comment in `lib/permissions.ts` read back: "Invoices, pay applications,
retainage". It is also the narrowest capability that still holds everyone
with a reason to send a GC their link — ACCOUNTING, who raises the
invoices, PROJECT_MANAGER, who drives the pay application, EXECUTIVE, and
every OWNER — while removing FIELD, PAYROLL_COMPLIANCE and ESTIMATOR, of
whom that file already says "Billing is out: what has been invoiced is not
an estimator's business". Not the `VIEW_JOB_COSTS` the contract-paperwork
four in the same module take: that one is scoped by its own comment to
cost, forecast, margin and WIP — the inside view, which the portal shows a
GC none of — and it would readmit ESTIMATOR.

**Gated AND hidden, because a gate alone here is a dead button.** Both
actions refuse by throwing, matching every sibling in their module, and
production redacts a thrown Server Action message to a digest. A visible
button whose refusal cannot be read is worse than a missing one: the
person clicks, nothing happens, and they file a bug. So the whole "Client
portal" section on `/contacts/[id]` now sits behind `showsBilling`. The
whole section, not just the buttons — two of its three branches print the
token itself, and showing the credential while hiding the button would
leave the interesting half on screen.

**What the existing census could see and why it could not act.**
`action-capability-guards.test.ts` had both actions listed by name in
`UNDECIDED_BEHIND_AN_AMBIGUOUS_PAGE` as "the highest-risk item on this
page" — its rule derives an action's capability from the page it sits
behind, and `/contacts/[id]` withholds three different capabilities
section by section, so it could derive nothing. They are now in
`SECTION_DECIDED`, the first debt that list has ever paid off, and the
suite EXECUTES both refusals: four new cases call each action as every job
function lacking MANAGE_BILLING, require a refusal before the database is
touched at all, and require every holder plus an OWNER through. That
list's header comment also claimed the page withheld MANAGE_BILLING for
"the client portal" — it did not; `showsBilling` wrapped Payment
reliability, and the portal section was wrapped in nothing. A capability
named in prose is not a capability in the source, so that line is
corrected too.

**The new guard, and why it is about a generator rather than two
function names.** A credential's risk does not come from the page it is
minted on — had these controls lived on a page that withheld nothing, the
existing census would not even have listed them.
`lib/portalCredentialCensus.test.ts` starts instead from `linkToken()`,
which `lib/tokens.ts` calls "the one generator for links that ARE their
own access control", plus the `Contact` fields that switch such a link on
and off. Every exported action in every `"use server"` module that mints
or switches one must assert a capability BEFORE its first query, or be
recorded as needing none with the reason — the two `calendarFeed` actions
are, because the token they mint is the caller's own row keyed
(companyId, userId). And every `action={…}` posting to a gated one must
sit inside a region the page withholds on the SAME capability. Scope comes
from `tsconfig.json`'s own `include` globs, the `"use server"` set is
counted a second time against the actions barrel, the field names come
from the Prisma schema, every `linkToken()` hit must be attributed to an
exported action or fail by name, and comments are stripped — which is not
decoration, because `billing.ts` prints `linkToken()` and `portalToken`
inside its own docblocks, one of them inside `enablePortalAccess`'s.

Fourteen mutations, each verified as actually applied before its result
was read, each red: guard removed from either action, guard present only
in a comment, guard moved below the first query, guard changed to the
wrong capability, the section's hiding removed, one form moved outside the
withheld region, the schema-field pattern matching nothing, the
`"use server"` detection drifted to single quotes, a new ungated minter
added, a new minter whose gate is only a comment, a `linkToken()` call
attributed to no action, a stale exemption, and an exempt action that
starts asserting a capability. The two that matter most are the ones where
a broken census would have gone quiet instead of red — the field pattern
and the directive detection both fail loudly with both numbers on screen.

Not fixed and deliberately left: `enablePortalAccess` still reactivates
the SAME token rather than rotating it (its own comment has said so since
#217), so revoke-then-enable hands back a string the GC's mail server has
already seen. That is a feature with a UI question attached, not a gate.
