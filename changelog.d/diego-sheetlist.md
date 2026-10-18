### The sheet index stops burying the five rows you can actually work (Diego)
`diego/sheetlist`

A 55-page plan set drew 55 rows in the review list, and 50 of them said only
"Sheet 23 of the file / Not read yet." Those 50 pushed the five rows somebody
could act on off the top of the screen.

The distinction is not about length, it is about whether there is anything to
do. A row with a proposal has a number to check, a title to correct and a Pick
or Reject to press. **A row without one has no control on it at all** — this
panel cannot read a sheet, and the only way to give an unread page a number is
to type it on the sheet itself in the viewer. So those rows were not a shorter
version of the work; they were a list of what is left, rendered as if it were
the work.

Now the rows with proposals are the list, and the rest collapse to one line:
*"Show the 50 sheets with nothing read off them."* Opened, they are page
ranges rather than fifty numbers — `6-8, 11, 12, 40` — and they keep the
distinction that decides the next step: a sheet that simply was not read can be
read again, while a scan has no text to read at all and must be typed on the
sheet. A reader told to "read it again" would otherwise try the one thing that
cannot work.

Still reachable rather than hidden. The page numbers are what somebody needs to
find those sheets in the viewer, and a count with nothing under it would make
the next step guesswork.

The splitting and the range-collapsing live in `lib/plan-ingest/sheetIndex.ts`
rather than in the component, which is that directory's own rule: the unit suite
runs in `environment: "node"` and cannot render, so logic that lives in a
component is logic no test can reach.

Two things fell out. A sort was written on the two leftover lists and then
deleted — every proposal-less row gets `reviewRank` 0, and `sortForReview`
already tie-breaks a shared rank by page number, so the walk emits them in page
order and the sort was unreachable. And the panel was first given
`bg-surface-card`, which resolves to nothing (issue #573); `colorTokenCensus`
pins that token's 16 existing sites and failed the build on the 17th, which is
the guard doing exactly its job.
