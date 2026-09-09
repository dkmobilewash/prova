### The counter that fixed invoice numbers stopped both cleanup scripts, and the test that should have caught it was green (Diego)
`claude/prova-contractor-os-e3f0iz`

#224 was right. Invoice numbers were the last sequence in the app still
coming from `max(number) + 1`, and `InvoiceCounter` ended that — delete
invoice 3 of 3 and the next one is 4, on a document a GC has already been
sent.

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

`CLAUDE.md` said "there is no `InvoiceCounter` anywhere in the repo",
which was true when it was written and false the moment #224 merged. It
now says what `main` actually holds, and adds the rule the whole episode
is about: a new counter is not done when it issues numbers correctly — it
is done when the scripts that delete jobs know it exists.
