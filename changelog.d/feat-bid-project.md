### What actually changed, in plain English (Cyrus)
`feat/bid-project`

Four GCs inviting you to price the same hospital used to be four unrelated rows, and only one of them could be linked to the estimate you built, so the other three either sat unlinked or you built the estimate again. There is now a **project** underneath the invitations: one piece of work, any number of GC invitations, one estimate.

- **Merge and split.** On any bid on `/bids`, open "Project" and pick "This is the same job as…" to fold two projects into one (two-step confirm), or "Not the same job as the others" to split one back out. Nothing is ever merged for you: the migration made exactly one project per existing invitation, because two GCs name one building differently and a wrong guess would point an estimate at another job's costs. Merging refuses in words when both projects already have an estimate, or record different prime winners, rather than dropping one.
- **Start the estimate from the project.** Name, address, bid date come from the project; the GC starts as the first one to invite you (or the awarded one, if the prime is already known) and switches to the winner when you mark that GC's bid Won or record the prime award, while the job is still an estimate. A contracted job's GC never moves. Two people pressing the button at once leave one job.
- **Who won the prime.** An entered fact on the project (a GC on your list, or a name, and a date). A GC whose project went to a different prime is no longer counted as a GC that turned your price down: those bids leave the win-rate denominator (on `/pipeline` and in the bid-research warning) and stop counting as outstanding or overdue. It is derived from the award every time, so clearing the award puts the numbers back. The row says "Didn't get the job", not "Lost".
- **Each GC keeps its own row.** Name as that GC wrote it, due date, status, price sent, send record. The price you sent a GC is compared with the estimate's total in words when they differ.
- "Log a bid" gains "Same job as…" and "We reached out (they didn't invite us)".

Not done, deliberately: `/bids` is still one row per invitation (the project line sits on each row; there is no grouped heading yet), and quotes, addenda and spec sections still hang off the invitation they were filed under rather than the project (the design's P1b).

The specific check: `pnpm exec vitest run --config vitest.db.config.mts lib/estimating/bid-project.dbtest.ts` runs the migration's own backfill SQL on seeded pre-migration rows (3 invitations in, 3 projects out, none merged, the estimate link carried, running it twice adds nothing) and then the merge, split, start-estimate race, award and win-rate cases against real rows.
