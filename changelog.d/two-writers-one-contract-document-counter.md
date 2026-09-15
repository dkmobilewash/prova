### Recording an executed subcontract no longer bricks contract-document upload (Diego)
`claude/prova-company-cam-feature-6170v6`

Issue #280. `ContractDocument` had two writers with two numbering schemes:
`uploadContractDocument` issued from `ContractDocumentVersionCounter`, and
`recordExecutedSubcontract` used `MAX(versionNumber) + 1` and never bumped
the counter. #106 finding 5 fixed the numbering on one of the two paths and
the other kept the defect the counter was added to remove.

**The cost was not a stale number, it was a permanent outage per job.** A
document written the MAX way leaves the counter behind the rows, so the
next ordinary upload issues a number that already exists and violates
`@@unique([jobId, versionNumber])`. Because the bump and the insert are one
transaction, the failure rolls the bump back too, so the next attempt reads
the same stale number and fails identically — for ever, with a message
production redacts. On a fresh job one click did it: the GC sends the
subcontract signed, that gets recorded as version 1 with no counter row at
all, and every later amendment upload on that job is dead.

Reproduced against a real Postgres 16 before anything was changed, both
orderings, with the counter column read back after every failed attempt to
show the rollback — that is what turns "they can collide" into "this job is
bricked and retrying cannot help".

**The fix is one issuer with two callers.** `issueContractDocumentVersion`
moves out of `lib/actions/billing.ts` to `lib/billing/contract-document-version.ts`,
beside `issueInvoiceNumber`, and both actions import it. It had to move:
a `"use server"` file may only export async Server Actions, so exporting an
internal counter bump from `billing.ts` would publish it as an endpoint any
signed-in caller could post to. That constraint is *why* it was private,
and being private is *how* the second writer drifted — worth naming,
because the next shared helper will hit the same wall.

**Existing rows needed their own repair**, and the code fix does nothing
for them. `20260915223000_resync_contract_document_version_counter` is data
only — no table, column, constraint or index changes — and brings every
job's counter up to the highest version it actually has.

It uses `GREATEST(existing, MAX(versionNumber))` rather than assigning the
max outright, and that word is load-bearing. A counter is *allowed* to sit
ahead of the surviving rows; that is the point of it. Delete version 3 and
the counter still says 3, so the next upload is 4 and the retired label is
never handed to a second legal document. Assigning the max unconditionally
would drag such a counter backwards and reissue it — the exact defect the
counter exists to prevent, reintroduced by the migration meant to repair
it. Idempotent, and a no-op where no executed subcontract was ever recorded.

**Three mutations, three caught, no survivors** — every file restored
byte-identical by `sha256sum`. Restoring the MAX path turns all five
cross-writer cases red; removing `GREATEST` turns exactly the
counter-is-ahead case red and nothing else.

**The third one SURVIVED first time, and that is the part worth reading.**
Moving the counter bump outside the transaction passed all eighteen cases,
because the upsert is atomic by itself — concurrent callers still get
distinct numbers and nothing collides. The difference only shows when the
INSERT fails: inside the transaction the bump rolls back, outside it the
number is burned and the job's versions gain a hole. CLAUDE.md states that
invariant directly and nothing in the suite could see it, so a case was
added that fails the insert on purpose and asserts the counter did not
move. The mutation is caught now. A suite that cannot distinguish the
shape it is defending is the vacuous-test shape this repo keeps paying for,
and it was only visible because the mutation was run.

The migration is exercised by reading the shipped `.sql` off disk and
executing it, rather than restating the statement in the test — a copy of
a migration in a test proves the copy works. The read asserts the file
contains `GREATEST` before anything else runs, so an empty or wrong read
fails loudly instead of passing every assertion downstream.

NOT CLICKED. Nobody has recorded an executed subcontract in a browser
against this change; it rests on the database tests.

Separately noticed and NOT fixed: `EstimateVersion` still numbers itself
`MAX(versionNumber) + 1` in `lib/actions/estimating.ts` and has no counter
at all. It has a single writer, so it cannot reach the cross-writer failure
above, but it is exposed to the reissue-after-delete and concurrent-submit
races the counter rule exists for. Reported rather than folded in.
