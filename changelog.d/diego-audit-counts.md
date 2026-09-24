### main was red on three numbers in FEATURE-AUDIT.md (Diego)
`diego/audit-counts`

**Docs-only, and it is the red-main fix rather than an audit** — `FEATURE-AUDIT.md`
is the only file that changes, and only three numbers in it.

Three PRs merged inside ninety seconds — #437, #471 and #460 at 02:33:10,
02:33:26 and 02:33:39. CI never reported on the first two; the third
superseded them, and it failed. `lib/plumbing.test.ts` caught exactly what it
was written to catch, and its own message had already predicted the shape:
*"after a merge BOTH sides' numbers are usually wrong, because each was right
before the other landed."*

Sheet 03's header said 12 built where its rows have 13, and the two
aggregates that derive from it — the `| Status | Count |` table and the
summary line — were each one short.

Recounted from the rows rather than by taking the delta, which is what the
test tells you to do. The recount found a fourth status the obvious parse
misses: `descoped`. 109 built + 22 partial + 4 missing + 1 descoped = 136
items, not the 135 a three-status count gives. Anybody fixing this by
inspection would have made the summary line agree with the wrong total.

`apps/web` is 447 files / 7045 tests green with the three numbers corrected.

Worth saying plainly: nothing was wrong with any of the three merged PRs.
Each updated the counts correctly for the tree it was written against, and
the arithmetic only disagreed once all three were on `main` together. The
test is the thing that makes that recoverable in two minutes instead of
being discovered a week later by someone reading the roadmap.
