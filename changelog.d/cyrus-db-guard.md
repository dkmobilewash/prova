### The db suite refuses to run against a real database (Cyrus)
`cyrus/db-guard`

On 2026-09-18 a `prisma migrate diff --shadow-database-url` was handed
Cyrus's dev database (ep-icy-hat) and Prisma did what it documents for a
shadow database: dropped and recreated it. Everything went; Neon's
point-in-time restore brought it back. The db suite carries the same risk
— it creates and deletes companies — and its config had said "run against
a SCRATCH database — never a real one" since it was written. A comment is
not a guard.

Now it is one: `vitest.db.setup.mts` runs as globalSetup and refuses any
`DATABASE_URL`/`DIRECT_URL` that is not localhost or a unix socket, before
a single test file loads Prisma. The check is `scratchProblem()` in
`connection-target.mjs` — pure, credential-free, tested against the real
Neon endpoints (pooled and direct, plus a `?host=` that is not a socket
path). No env-var escape hatch, on purpose. CLAUDE.md gets the full scar
entry, including the three rules for anyone generating migration SQL.
