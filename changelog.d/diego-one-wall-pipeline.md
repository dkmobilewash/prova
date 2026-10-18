### The bench was grading a worse pipeline than the one that ships

`bench/harness.ts` said of its copy of the wall finder: *"`TakeoffPlanViewer.onFindWalls`,
line for line, against a PDF in memory."*

**It was not.** Counting the markers, the viewer had seven and the harness had
one — a comment. The copy had drifted in three ways:

| drift | what it did |
| --- | --- |
| **`curved` dropped** when rebuilding the stroke objects | `wallRuns.ts` filters `curved !== true` to keep arcs out of the room engine. A missing flag reads as "not curved", so the arc goes back in — and the viewer's own comment predicts it: *"a flattened arc would reach the room engine again and the lobby wall would be billed twice: 1,957 ft against a key of 1,894."* |
| **no `wallsNotTheScaleBar`** | the graphic scale bar — two parallel lines a wall thickness apart and 32 ft long — counted as a wall. The one thing on a sheet that is literally a ruler |
| **no template pass** | inert here, because `templateFromSheets` needs `MIN_SHEETS` and the fixtures are single-page. A divergence in code, not in result, waiting for the first multi-sheet run |

Both live drifts **add** false walls. Nobody was careless: the copy was honest
when it was written and the product moved underneath it. There is one
implementation now, so there is nothing left to drift.

A fourth, smaller one went with it: `harness.ts` explained a miss with
*"sheetStrokes skips curveTo: a curved wall has no straight faces to pair"*,
while `sheetStrokes.ts` has pushed `curved: true` for some time. Curves **are**
read. That sentence told the reader the opposite of what happens.

### What it measures, before and after

Same fixtures, same answer key, one run each side.

| | before | after |
| --- | --- | --- |
| Phantom feet on the 9 zero-wall cases | 20,655 ft | **20,416 ft** |
| Walls missed entirely | 113, over 26 cases | **112, over 25 cases** |
| Worst in-scope LF error (A-101 D1, autocad/skia) | 31.3% | **30.6%** |
| Scale: wrong-but-confident | 6 | 6 — unchanged, and expected: the scale is read by a different path |

**−239 ft of phantom wall, averaging 26.6 ft a case against a 32 ft scale bar.**
That is the mechanism arriving as arithmetic rather than as a claim.

Per the standing grading rule, the three numbers separately: found footage went
**up** (one fewer wall missed), not-on-a-wall footage went **down**, and no
constant was moved to make either land.

### What moved

`lib/takeoff/findWallsOnSheet.ts` is the pipeline: the stroke conversion, the
template filter, both engines, all four geometric filters, the tags, the general
note and the grouping. Pure — no pdf.js, no DOM, no database — so the viewer
hands it a page it has open and the bench hands it one it read from a file.

**The y convention is now settled in one place.** `planPdf.pageText` stores the
BASELINE; the viewer used to subtract the glyph height before passing anything
on. Two correct conventions for one thing, and a caller that mixed them would
put every text box one glyph height low — silently, because nothing throws: the
lettering filter simply stops covering lettering. The shift happens inside the
pipeline now and no caller does it.

**The stages come back, not just the answer.** The bench uses `everywhere` and
`inBuilding` to name *which* filter dropped a wall, which is its most useful
diagnostic and would have been destroyed by returning only the final walls.

### The censuses moved with it, and one stopped being a census

Seventeen source-text assertions across six files pinned the component. Each
describes itself as *"the call site, because no test here can open a PDF"* —
the apology for greping source. They now read the file that can contain the
answer, and the three in `takeoffWallFinder.test.tsx` that sat in the same block
as viewer facts were split rather than dragged along.

**One became a real test**, which is the dividend: `flattenCubic.test.ts` used to
grep the component for `curved: one.curved`. `inPageWidthUnits` is a function, so
it now calls it and asserts the flag survives — and that an ordinary segment does
not acquire an invented `false`. That is the exact defect the bench had.

### Deliberately unchanged

**The two `realplan/` evals are still copies**, named here so the next person
finds them rather than rediscovering them. Moving three sets of numbers at once
would make a regression impossible to attribute.

**Two existing defects are preserved**, so this measures one change: `chosen` is
keyed by index and is not reindexed when a group is accepted out from under it,
and `templateStrokes`/`strokesSeen` are page-less siblings of the bug
`wallsOnThisSheet` fixed for `found`. Both are real; both are their own PR.

The bench reports under `reports/takeoff-bench/` are **not** in this commit. They
were already modified in the working tree by another session before this work
started, so committing them would mix somebody else's changes with these. They
regenerate with `TAKEOFF_BENCH=1 pnpm takeoff:bench`, which is what produced the
table above.

### The shift that nothing could see

Two mutations exposed a hole the lift had just created and the plan had named in
advance: **dropping the glyph-height shift, and reversing its sign, both left all
11,042 tests green.** The worst shape a defect can have here — nothing throws,
`wallsNotLettering` simply stops covering the lettering, and the only symptom is
a wall miscounted on a drawing nobody re-measures by hand.

So the shift is a named function, `fromBaseline`, because a line inside a
pipeline cannot be held still and a function can. Both mutations now red.

`knownThicknessesIn: []` was the third: the census asserted the KEY was in the
call and could not see that the value had become empty — an empty question
looking exactly like a satisfied one, which is this repo's own "derives its
input" failure. It pins the value now.

**13 of 13 mutations red, with a no-op control staying green** so the harness is
not merely reddening on contact. One mutation was withdrawn as invalid rather
than counted as a miss: handing the template an empty sheet array instead of
`null` is behaviourally identical, because fewer than `MIN_SHEETS` yields an
empty template and the `size > 0` guard then skips the filter on both paths.

The bench was re-run after the extraction and is **byte-identical** to the table
above, which is what makes it a refactor rather than a claim.
