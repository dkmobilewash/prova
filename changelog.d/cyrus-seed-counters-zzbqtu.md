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
