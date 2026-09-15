### The amendment that could not be uploaded — #279 (Diego)
`claude/prova-ai-task-completion-96pjes`

A GC sends the executed subcontract. Weeks later they send an amendment.
The second one would not save, and the app said nothing that named a cause.

WHAT WAS WRONG. `ContractDocument` has two writers.
`uploadContractDocument` took its `versionNumber` from
`ContractDocumentVersionCounter`, correctly, inside the insert's own
transaction. `recordExecutedSubcontract` computed `MAX(versionNumber) + 1`
and never created a counter row at all — so recording the executed
subcontract put version 1 in the table with nothing behind it, and the next
upload's `upsert` found no counter, created `lastNumber: 1`, issued 1, and
violated `@@unique([jobId, versionNumber])`.

THE PR THAT FOUND THIS CALLED IT A RACE. It is not, and that mattered: a
race sounds rare and survivable, so it waits. Reproduced against a real
Postgres 16, it fires on the ordinary order of events — one person, two
clicks, weeks apart — and the reverse order collides one version later, when
the executed subcontract writes 2 without bumping the counter and the next
upload issues 2 again. Neither action guards P2002 and both return
`ActionResult`, so production redacted it to a digest on a legal document.

THE FIX IS WHERE THE HELPER LIVES, more than what it does.
`issueContractDocumentVersion` was module-private in `lib/actions/billing.ts`,
which is `"use server"` and may therefore only export async Server Actions —
so the second writer COULD NOT import it however much it wanted to, and did
the only thing left. It moves to `lib/billing/contract-document-version.ts`
beside `issueInvoiceNumber`, which was extracted for exactly this reason and
is the precedent. One implementation, because a second copy recreates the
divergence it is meant to end.

THE CODE FIX ALONE WOULD HAVE LEFT THE LIVE DATA BROKEN. Every job whose
contract documents arrived through the executed-subcontract path since 9 Sep
already has a missing or stale counter and is primed to collide on its next
amendment. A data-only migration reconciles them, and `GREATEST` is the
load-bearing word in it: a counter may legitimately sit ABOVE the surviving
rows because `deleteContractDocument` is a real action, so taking `MAX`
unconditionally would LOWER such a counter and reissue a version already
sent to a GC. Proved by mutation — with `GREATEST` removed, a counter at 5
against a max of 2 drops to 2 and reissues three numbers.

WHAT THE EXISTING GUARDS COULD NOT SEE, which is why this shipped.
`counterCensus.test.ts` asks whether every counter is bumped, inside a
transaction. `ContractDocumentVersionCounter` passed both — one of the two
writers did bump it, properly. "Is the counter used" and "is the counter the
only source of the number" are different claims and only the second is the
rule, so the census now asks from the other end: does every writer of a
numbered table go through its counter. The map of counter → table it numbers
cannot be derived (`SafetyCaseCounter` numbers `SafetyIncident`, and no
naming rule gets you there), so its keys are pinned to the schema's own
counter list — a new counter fails until somebody writes down what it
numbers, and the declaring is the review. Running it across all nine found
no other divergence; both `changeOrder` writers, both `invoice` writers and
the rest already route through their helpers.

FIXING IT BROKE A TEARDOWN, and that is the #227 scar one layer down.
`jobLifecycle.dbtest.ts` deleted the documents but not the counter, which
was correct only while this path created no counter row. The counter is a
RESTRICT child of `Job` that deleting the DOCUMENTS does not reach, so the
job delete failed the moment the fix landed. The real cleanup scripts
already handle this model; the teardown did not.

Mutation-tested throughout: reverting the numbering turns the new database
cases red with `expected undefined to be 1` (the null counter row) and
`Unique constraint failed on the fields: (jobId, versionNumber)` in both
orders, and turns the new census red naming the file and the helper — while
all seven pre-existing counter tests stay GREEN, which is the measurement
that explains the week this sat on `main`. The unit suite's fake now
enforces the unique constraint and models the counter properly, because a
fake that accepts a collision the database would refuse can only ever agree
with itself.

Typecheck 0, lint 0 errors, 168 files / 2811 unit tests, 36 files / 418
database tests, production build exit 0.
