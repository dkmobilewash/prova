### The error boundary says "database" only when it IS the database (Cyrus)
`cyrus/boundary-drift-digest` — follow-on to #407, found by clicking it

A thousands comma typed into an invoice Amount field crashed the page (a
parsing defect owned by another sweep, not fixed here). The new boundary
caught it correctly — and then told the tester "on a preview this is usually
the database, run the Migrate demo database workflow". The wrong diagnosis
with a confident face: that advice is exactly right for schema drift, which
is what took the founder's first screen down that morning, and useless for
a form-parsing throw. The boundary showed it for EVERY failure on a preview
because it could not tell them apart — production redacts the error's
message to a digest, and a missing column and a bad number arrive looking
identical.

But Next.js keeps a digest the SERVER sets itself (`create-error-handler.js`:
"if the error already has a digest, respect the original digest" — it is how
`redirect()` and `notFound()` travel). So the Prisma client now stamps
`SCHEMA_DRIFT_P2021` / `SCHEMA_DRIFT_P2022` on a "table/column does not
exist" error, through one `$extends` query hook covering every model
operation, raw query and transaction (`packages/db/src/schema-drift.ts`,
wired in `packages/db/src/index.ts`), and touches nothing else.
`PageLoadError` reads it through a client-safe twin (`apps/web/lib/
schema-drift.ts`; a test asserts the two prefix literals agree):

  - preview + drift → "this is the database, not the code" — run the workflow;
  - preview + anything else → the workflow "will not fix it… more likely a
    bug on this branch, or something typed into a form";
  - production + drift → the #378 deploy window: usually clears in a couple
    of minutes, reload, then report;
  - production + anything else → nothing extra; the digest is the report.

**The extended client is typed as the plain `PrismaClient` on purpose.**
Exporting Prisma's extended type produced 20 `TS2345` errors at
`tx: Prisma.TransactionClient` call sites — `billing.ts`, `changeOrders.ts`,
`jobs.ts`, both lanes — files this change has no business touching. The only
members `$extends` drops at runtime are `$on` and `$use`; nothing calls them,
and `errorBoundaryCoverage.test.ts` fails the build the day something does.

Proved on a real database, not argued: `lib/schema-drift.dbtest.ts` drops
`Company.website` inside a transaction against the scratch Postgres, queries
the model, asserts the real P2022 comes back stamped `SCHEMA_DRIFT_P2022`,
and asserts the rollback put the column back. Four mutations (boundary treats
everything as drift; marker no-op; hook rethrows unmarked; a file calls
`prisma.$on`), four red.
