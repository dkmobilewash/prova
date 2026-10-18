### Finding the walls stops paying for the empty part of the sheet (Diego)
`diego/wall-hang`

A sweep across eleven real plan sets found pages taking seconds to read, and one
— Houston Hobby p7 — that ran **28½ minutes of CPU and never returned**. In the
app that is a frozen tab with no way out, which is worse than a wrong answer.

Timed stage by stage rather than guessed at, and the first two theories were
both wrong. It is not `wallsInTheBuilding`, which runs in **1 ms**. It is
`thin()`, the step that reduces a wall's shape to its centreline:

| | mask cells | grid | thin |
| --- | --- | --- | --- |
| Alden Green p20 | 26,848 | 4096×2926 = 12M | **2,582 ms** |
| Comfort Inn p51 | 103,368 — four times the ink | 2880×1920 = 5.5M | 571 ms |

**Four times the work, a fifth of the time.** Cost was tracking the GRID, not
the ink: every round swept all twelve million cells looking for the few that
were set, and thinning takes one round per cell of half-thickness — so it
visited 12 million cells about fifty times to erode twenty-seven thousand.

Thinning only ever CLEARS cells; nothing is ever set. So the candidates can only
shrink, and keeping them is both exact and cheap:

| | before | after |
| --- | --- | --- |
| Alden Green p20 | 2,582 ms | **50 ms** |
| Comfort Inn p51 | 571 ms | **36 ms** |
| whole page, Alden | 5,412 ms | **1,105 ms** |

**The skeleton is byte-identical** — the same 3,177 paths and 3,268 paths come
out of the two sheets, and the same walls. The condition was faster, not
different.

**Houston Hobby p7 is NOT this defect**, and that is worth recording because the
fix was pointed at it first. Instrumented stage by stage, that page spends more
than six minutes inside `pageStrokes` and never reaches any wall code at all —
the hang there is in reading the PDF's operator list, a different layer with a
different answer (a time budget on reading a page, so a sheet that cannot be
read says so and leaves the manual tools working). It is not fixed here.

The guard is a RATIO between two grids holding identical ink, never a wall-clock
budget — an absolute bound fails on a loaded machine and passes on a fast one,
and this repo already has one spec that answered differently twice in an hour.
Its threshold is measured rather than chosen: the live-cell version runs the
large grid at about 62× the small one and a grid-swept version at about 616×, so
the bound sits between with roughly 3× of margin each way. The first version of
it was guessed at 20 ms and the defect came in at 21.5 ms — just under — so the
mutation passed. A threshold picked before the measurement is one that admits
the bug.

One guard is kept and labelled as untested rather than implied: excluding the
border from the candidate list is not observable in the output, because a border
cell that becomes a candidate reads its neighbour ring off the end of a typed
array, gets `undefined`, goes NaN and survives every deletion test anyway. Same
answer, by accident. It stays so the reads are in bounds rather than depending
on that, and the test says so.
