### The recount note reached `main` arguing from a number that had moved (Diego)
`claude/testing-season-strategy-1gdcsv`

`FEATURE-AUDIT.md`'s history note said the 26 per-sheet headers summed to
**125 / 99** and that this agreed "with the prose line and the summary table".
Seven lines above it, the prose line said **126 items audited — 100 built**,
and the summary table said 100. Three numbers, all wrong, in the one paragraph
whose subject is two numbers disagreeing with nothing marking which to believe.

Corrected to 126 / 100, re-derived three independent ways rather than copied
from the line above: the 26 `## NN.` headers sum to 100 + 19 + 6 + 1 = 126;
counting real feature rows (`| Status | <text> | <evidence> |`, never the
summary table's own `| Status | <number> |` rows) gives 126; the summary table
reads 100 / 19 / 6 / 1.

**The note was right when it was written, and that is the part worth keeping.**
#233 was cut from `main` at `b8542b8`, where the headers genuinely summed to
125 — verified. #236 added sheet 17's photo-markup row while #233 sat open.
The two edits touch different lines, so git auto-merged them with no conflict,
and the stale arithmetic landed. Nothing went red: no test asserts these
totals and CI does not read prose.

So the note now carries the date of its measurement and says to re-take it
against `main` immediately before merging rather than when the branch was cut.
A re-derivation is a measurement with a date on it, not a fact — which is the
same lesson the `MIGRATE_EXPECT_HOST` deletion and the counter roll-call
(#234, now `counterCensus.test.ts`) were each written to record.
