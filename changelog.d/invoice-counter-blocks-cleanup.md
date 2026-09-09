### The counter that fixed invoice numbers stopped both cleanup scripts, and the test that should have caught it was green (Diego)
`claude/prova-contractor-os-e3f0iz`

#224 was right. Invoice numbers were the last sequence in the app still
coming from `max(number) + 1`, read outside any transaction, and
`InvoiceCounter` ended that. Its own body is careful about why that
mattered and this entry follows it: the reissue story needs a
`deleteInvoice` the app does not have. The reachable defect was the race —
two concurrent submits on one job collided on `@@unique([jobId, number])`,
which production redacts into an unexplained failure on a GC-facing
document.

What it also did, unnoticed, was add a RESTRICT child to `Job` that
nothing cleans up. A per-job counter is keyed on `jobId`, not on the
invoices, so deleting every invoice on a job leaves the counter behind and
the counter then refuses the job delete. Both cleanup scripts were
affected: `clean-scratch-data.mjs` would have died partway through, and
`clean-test-jobs.mjs` would have refused up front — correctly, and by
design, but still refusing to clean the test jobs it exists to clean. That
matters this week specifically, because the next thing anyone does is
click through eight merged PRs, invoice things, and then try to remove
them.

**The part worth writing down is why nobody knew.**
`scratch-cleanup-order.test.ts` exists to catch exactly this: add a model
with a required `jobId` and it fails on a laptop in a second, instead of
failing on somebody's database halfway through a delete. It derives the
blocking foreign keys from the migration SQL, which is the right source —
the database enforces what the migrations wrote, not what the schema file
reads like.

Its pattern spelled every gap in the `ALTER TABLE … ADD CONSTRAINT …
FOREIGN KEY … ON DELETE …` statement as one literal space. That was
invisibly fine for 180 foreign keys, because Prisma generates that
statement on a single line. #224's migration was written by hand and
wrapped after the constraint name, so the pattern skipped it: the derived
set came back 180 instead of 181, the single missing entry was
`InvoiceCounter.jobId -> Job RESTRICT`, and all thirteen tests passed.

A guard that parses its own input has two failure modes and only one of
them looks like a failure. It can get the answer wrong — that goes red. Or
it can get an empty question — and an empty set passes every downstream
assertion, because nothing is ever missing from an empty list and nothing
is ever out of order in one.

**The checks.** The pattern is whitespace-insensitive now, so SQL
formatting stops being load-bearing. More importantly the file counts the
literal string `FOREIGN KEY` across the migrations independently of the
pattern that parses them, and requires the parse to return exactly that
many — so the next formatting surprise reads "the migrations declare 181
foreign keys and this file parsed 180" instead of quietly shrinking the
set. Both were mutation-tested: restoring the old single-space pattern
turns the count test red with that message, and removing the new
`invoiceCounter` delete turns the order test red naming the table.

`InvoiceCounter` is now deleted by `clean-scratch-data.mjs`,
`seed-demo.mjs --undo` and `clean-test-jobs.mjs`. `SafetyCaseCounter`
still is not, and that is not an oversight — it is company-scoped, a
high-water mark rather than per-job data, and resetting it reissues a
retired OSHA case number (#148). Per-job counters go with their job;
company-level ones never do.

`CLAUDE.md`'s counter entry was corrected by **#225**, not by this — that
session got there first and with the better version: the roll call
re-derived by two commands rather than asserted, and the retirement of the
"delete invoice 3 of 3" story that #224 showed the product cannot do. This
branch had written a competing correction; it was dropped in favour of
theirs when main was merged in, rather than argued for.

What this adds to that entry is the one thing neither #224 nor #225
covered, because both were looking at numbering: a new counter is not done
when it issues numbers correctly. It is done when the scripts that delete
jobs know it exists.
