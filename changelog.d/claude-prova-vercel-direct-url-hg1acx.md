### Invoice numbers come from a counter — the eighth, and the last one that didn't (Diego)
`claude/prova-vercel-direct-url-hg1acx`

CLAUDE.md's sequence rule says a number comes from a counter row that only
increments, bumped inside the insert's own transaction, never `max(n)+1`
off surviving rows. Seven counters obey it. Invoice numbers did not —
`billing.ts:152` read the highest surviving number and added one, outside
any transaction, with both call sites computing it and calling `create`
separately.

**The documented reason to care was wrong, and correcting it is half of
this change.** The rule's headline is "delete invoice 3 of 3 and the next
invoice is 3 again, on a document a GC has already been sent". There is no
`deleteInvoice` in this app: every `invoice.delete`/`deleteMany` in the
repo is dbtest teardown, `clean-scratch-data.mjs` or `seed-demo.mjs`.
Reissue-after-deletion needs a row removed by hand, and the absence of that
path is deliberate — an invoice is an evidence record that closes rather
than deletes.

**The reachable defect was the race**, and it is reproduced rather than
argued: two concurrent submits on one job under the old implementation
throw `Unique constraint failed on the fields: (jobId, number)`, which
production redacts to a generic failure. `createInvoice` returns void
rather than an `ActionResult`, so there is not even a message to render.
#19's in-flight button disable and the pay application's ten-second
duplicate guard narrow that window; neither closes it, and neither helps
two people billing one job at once.

**The migration's backfill is the load-bearing line**, and it was tested as
one against a real Postgres 16: apply every migration except this one, seed
a job with invoices 1-3, then apply it — `lastNumber` 3 for that job, no
row for a never-invoiced one, next numbers 4 and 1. Deleting the backfilled
row reproduces what its absence would do: the counter issues 1 and the
insert fails on `Invoice_jobId_number_key`. Without it this change would
have broken billing on every live job.

Stated because it cannot be fixed: a job whose invoices were *all* deleted
before this lands starts at 1 again, since nothing records what it once
issued. Going forward the counter row persists — nothing deletes one.

Found on the way and fixed here: `billing.dbtest.ts`'s pay-application
teardown deletes `Job` while an `InvoiceCounter` row still references it,
the same `ON DELETE RESTRICT` shape #136's foreign key surfaced in three
`afterAll` blocks.
