### "Create invoice" was permanently dead on every demo-seeded job (Cyrus)
`cyrus/seed-counters`

**On the demo project and every Vercel preview — which is where testers and
demos land — the "Create invoice" button could not work, ever.** Not flaky.
Permanently. Production seeds nothing and was never affected.

`packages/db/scripts/seed-demo.mjs` wrote three `Invoice` rows (#1, #1, #2)
and two `ChangeOrder` rows (#1, #2) and created **neither counter**, while
seeding the other six correctly. So on a seeded job:

1. `issueInvoiceNumber` upserts the missing counter with `lastNumber: 1`;
2. the insert collides with the seeded invoice #1 on `@@unique([jobId, number])`;
3. the bump and the insert are one `$transaction`, so **the counter rolls
   back with the failed insert** — the next attempt issues 1 again.

Reproduced against a real Postgres before fixing it, which is the only way
the "permanently" in that sentence is a fact rather than a reading of the
code. Three attempts on a seeded job, all identical:

    attempt 1: issueInvoiceNumber returned 1
    attempt 1: FAILED -- Unique constraint failed on the fields: (`jobId`,`number`)
    attempt 1: counter row afterwards = NONE (bump rolled back)
    attempt 2: issueInvoiceNumber returned 1   ... same
    attempt 3: issueInvoiceNumber returned 1   ... same

After the fix, on the same job: invoices #3, #4 and #5, issued and inserted.

**The counters are DERIVED from the rows, not written as literals.** The six
that were already there are hand-written numbers sitting next to the rows
they have to agree with, which is exactly the arrangement that let two of
them simply never be written. These read the seeded rows back with a
`groupBy` max, so adding a fourth invoice cannot leave the counter behind.
They also only ever go UP: change-order drafts are deletable, so on a
`--force` re-seed the highest surviving number can sit below the highest
ever issued, and writing that back down would reissue a number a GC has
already been quoted.

**Why the guard that exists for this was green the whole time, and the fix
for that.** `apps/web/lib/counterCensus.test.ts` was written precisely to
stop a counter going unbumped. Its patterns were fine. It walks `apps/web/lib`
and takes `.tsx?` only, so a `.mjs` script in `packages/db` was never a
candidate — CLAUDE.md's `theme-contrast` scar, arriving from the same side:
**nothing is ever missing from a directory you do not walk**, and no size
assertion can see it, because a pattern that matched plenty is not a pattern
that stopped matching.

Two live files were outside that walk and happened to be *correct*, which is
the more unsettling half: the v1 API routes for material orders and
incidents bump their counters inline, well outside `apps/web/lib`. A third
route that forgot would have been just as invisible.

So the census now scans **every source file `git ls-files` reports**, at any
extension, and requires each one that inserts a numbered row to make the
counter agree — by calling the issuing helper (app actions) or by bumping the
counter itself (the API routes, the seed). Scope is pinned to git rather than
to a directory list, because a directory list is the defect. It also pins a
known member of the set — `seed-demo.mjs` and the eight numbered families it
writes — since a count of an empty set looks perfectly healthy.

Mutation-tested three ways, each producing a different failure:

| mutation | what went red |
| --- | --- |
| drop the invoice counter from the seed | names the file, the accessor and the counter |
| narrow the scan to `.tsx?` | "no .mjs file in scope — the walk has narrowed" |
| break the insert pattern | the size check: "expected 0 to be 30" |

**And a database test, because a source scan cannot answer this one.** The
census is file-level: a script that seeds a counter for job A and writes rows
for job B passes it and is still broken. `seed-demo-counters.dbtest.ts` runs
the real `node scripts/seed-demo.mjs` against the scratch database, then
checks every per-job counter against the highest number actually written, per
job — and issues a real invoice number through `issueInvoiceNumber` and
inserts it, twice, against the real unique index. It also undoes and re-seeds,
because a seed that cannot be re-run is its own bug (#180). Reverting the seed
fix turns it red naming both counters and the constraint.

`ChangeOrderCounter` and `InvoiceCounter` were already deleted in the right
order by `--undo` and by `clean-scratch-data.mjs`, checked rather than
assumed — so nothing in #227's three-edit rule was outstanding.

**What Cyrus has to do for a preview to be usable again:** Actions tab →
**Seed demo database** → `undo`, then run it again with `seed`. The fix is in
the script, so an already-seeded demo database keeps its broken data until it
is rebuilt.
