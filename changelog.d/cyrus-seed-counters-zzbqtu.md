### The seed workflow can finally tell you which company is which (Cyrus)
`cyrus/seed-counters-zzbqtu`

Seeding the demo database could only ever fill the OLDEST company, and the
oldest company is usually not the one you are signed into.

A preview signs you in against the DEVELOPMENT Clerk instance and talks to
the demo project, so an address with no row there falls through
`requireCompanyContext`'s create branch and gets a brand new empty company
named `${name}'s Company` — CLAUDE.md's preview-company trap. Seeding then
fills somebody else's company and every list page on yours keeps showing its
empty state, which reads exactly like a broken app rather than like being in
the wrong tenant.

The escape hatch already existed: `SEED_COMPANY_ID`. It was unusable, and
the reason is the point of this change — **nothing in the product renders a
company id.** In `apps/web`, `company.id` appears only inside `where`
clauses, never in markup, so there was no screen, no URL and no export that
could tell an operator the id of the company they were looking at. The only
window into that database is this workflow's log, and the log could name one
company: the oldest one, which is the one you did not want.

So `seed-demo.mjs --list-companies` names every company with its id, its
creation date, its job count, how many of those jobs are `[demo]` rows, and
its user count — and `seed-demo.yml` exposes it as a `list-companies`
operation, listed above `list-scratch` because it is now step 0.

Read-only by construction: `findMany` and `count`, no write of any kind, and
it returns before either `--undo` or the reseed guard is reached. It still
passes the host assertion first, so it cannot be pointed at a database
nobody named.

It prints the total job count AND the `[demo]` subset because those answer
two different questions. "Which company holds the demo set" is the one you
came for; "does this company have rows a person typed" is the one that
decides whether seeding it is safe.

Measured, not assumed: run 36357811840 of the existing workflow printed
`seed: company My Company (cmtibkez70001jm04y9q0d4zo)` and then refused,
which is how the mismatch was found — a company named from the
`requireCompanyContext` fallback for a Clerk identity with no name on it,
holding all four demo jobs, while the person trying to film was in a
different company entirely.

`plumbing.test.ts` covers the new invocation for free, and that is worth
stating rather than assuming: it counts `node …mjs` commands two ways and
requires the two to agree, so adding an operation that pointed at a script
this repo does not have would fail there rather than showing as a button
that runs and says "cannot find module".

Two more things came out of filming with it.

**Seeding a SECOND company on one database died half-way.** `providerMessageId`
was built as `demo-[demo]-${toAddress}-${sentAt}` and is `@unique` in
`messaging.prisma` with no company in the key — correctly, since it holds a
provider's own id. So it is unique per company and collides across them. The
jobs, contacts, crew, 49 time entries and equipment committed; the messages did
not. That is issue #180's shape, and the reseed guard then refuses the retry, so
the company is stuck until somebody runs `--undo`. `company.id` is in the tag
now. The other five globally unique fields on models this seed writes were
checked by intersecting every single-field `@unique` in the schema against every
model the seed calls `create`/`upsert` on.

**That check was right about the conclusion and WRONG ABOUT ONE OF ITS
REASONS**, corrected here from the guard that was written to replace it.
Four of the five — `Contact.portalToken`, `CrewMember.linkedUserId`,
`OutboundMessageEvent.providerEventId` and `BidInvitation.wonJobId` — are
never written by this script, so each stays null, and null does not collide
under a unique index in Postgres. The fifth, `WarrantyPeriod.jobId`, **is**
written (`jobId: cedar.id`), and is safe for a different reason: a cuid from
a job this same run created is globally unique by construction.

The distinction is the whole rule rather than a footnote. "Not written,
therefore null" would have passed a field written with a hardcoded literal,
which is exactly the defect being fixed. The rule is: **null, or carries
`company.id`, or carries some row's generated id** — and a flat "must contain
`company.id`" would have failed `WarrantyPeriod.jobId`, which is correct as
it stands.

**`--camera-names` takes the `[demo]` tag off the jobs and the GC contacts**,
which is the twelve-trips-through-Job-details chore before a screen recording.
The interesting half is what it must not break. `undo` finds jobs by
`name contains [demo]` and then scopes about forty child models by the resulting
`jobIds`, so a job it cannot match does not merely survive — its whole tree
survives with it, and the run still reports a clean removal. Same for contacts.
So the names live in `DEMO_JOB_NAMES` / `DEMO_CONTACT_NAMES` at the top of the
file, undo matches the tag OR one of those exact names, and the rename strips
the tag and nothing else: it takes no new name, and refuses rather than write
one the constants do not know, because that is a row nothing could ever remove.
`--restore` puts the tags back.

The trade is stated rather than hidden: a job a PERSON creates with exactly one
of those names in the same company would be removed by `--undo`. The names are
distinctive, this only runs against the demo project, and undo now prints every
untagged row it matched before deleting anything — "removed 4 jobs" reads
identically whether or not one of them was somebody's own.
