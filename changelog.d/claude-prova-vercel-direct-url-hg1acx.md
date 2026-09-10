### The InvoiceCounter cleanup hazard, asked of the database instead of the SQL text (Diego)
`claude/prova-vercel-direct-url-hg1acx`

#227 registered `InvoiceCounter` in the three cleanup scripts and made
`scratch-cleanup-order.test.ts`'s regex whitespace-tolerant, so it parses
182 of 182 declared foreign keys instead of 180. #228 shipped the
by-result counterpart for `ContractDocumentVersionCounter` — a dbtest that
creates a job, deletes only its documents, and watches `job.delete()`
refuse. The equivalent for `InvoiceCounter`, the counter the whole shape
was found on, was never written. This is it.

**Why both halves are needed.** The static check reads the migration TEXT
and asks "is this constraint declared and handled". It was blind to
exactly this constraint for a day because #224's `ALTER TABLE` wraps after
the constraint name, and a check that never receives a question passes it.
The dbtest asks Postgres instead, so no amount of formatting can hide the
answer.

**Both new cases name the constraint rather than merely expecting a
throw**, and that is the point rather than a flourish. `rejects.toThrow()`
goes green if *any* child blocks the job — the `Contact` does, and a
relation added next month would too — so it can pass while proving nothing
about the counter it is named after. Prisma exposes
`meta.constraint`, so the assertion is
`InvoiceCounter_jobId_fkey` exactly. Mutation-tested twice: delete the
counter before the attempt (2 red — the job is no longer blocked at all)
and assert the wrong constraint name (1 red).

The same weakening was in #228's sibling case, so it now carries the same
named assertion. One line of behaviour, no test removed.

Run against a real Postgres 16 in this container, not only in CI: the full
database suite is 30 files / 318 tests green.

**One thing worth recording because it cost the run twice.** The suite
first reported 12 failures with `PrismaClientValidationError`, and they
reproduced on clean `main` — which reads exactly like "main is broken".
It was a stale generated client: `prisma migrate deploy` does not
regenerate, so a client generated before #228's columns existed rejects
queries the schema now allows. `prisma generate` and all 318 pass. This
file already records that `migrate deploy` leaves the client alone; it is
worth knowing that the symptom is a validation error on unrelated
suites, which looks like someone else's bug.
