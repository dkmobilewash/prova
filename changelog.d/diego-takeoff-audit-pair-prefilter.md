### The pair budget stops predicting and starts counting, and A101 measures

`wallsFromStrokes` refused a sheet when `n×(n−1)/2` exceeded `MAX_PAIR_TESTS`,
decided before any work happened. Camp Bow Wow A101 — 16,538 lines, the sheet
an estimator would actually price — scores **136.7 million** on that
arithmetic and was refused outright. The work it was predicting is **286,783
pair tests**, and the whole of `findWallsOnSheet` takes seven seconds on it.

The estimate was not wrong that the loop is quadratic. It was wrong that every
iteration costs a pair test. A pair is a wall only if it is within a wall
thickness *perpendicular* **and** the faces *overlap* along their length —
together those mean the nearest points of the two segments are within a
thickness, so their bounding boxes are too. Four comparisons reject the rest.

| sheet | candidate pairs | after the filter | that succeed |
| --- | --- | --- | --- |
| A101 | 136,744,453 | **286,783** | 6,938 either way |
| A102 | 51,770,400 | **157,084** | 3,672 either way |

The success counts are identical, which is the correctness claim: the filter
only removes pairs the predicate would have rejected. Loop order is untouched —
every survivor is tested by the same predicate in the same ascending order — so
the widest-partner choice and its first-wins tie-breaking are unchanged.

**A101 now measures: 2,776 ft over 190 runs in 7.2 s, with `MAX_PAIR_TESTS`
unchanged at 40M.** Every sheet that measured before is byte-identical: A103
29 ft/2, A1.2-3 3329/424, A1.2-4 3354/430, A1.2-5 3367/433, A1.2-6 3357/430,
A102 2255/163, A140 475/114. Twenty fixtures 13 of 17 within 2%; bench
unchanged. Real-plan floor plans measured: **8 of 9**.

**The guard that was testing the wrong thing.** `sheetDensity.test.ts` built
its dense fixture by spreading segments "so no two are a wall thickness apart"
— by construction nothing in it can pair. Under the old arithmetic 10,000 of
them refused; under a counter they cost nothing and pass, which is correct, and
is the A101 defect in miniature. That fixture is kept and now asserts the
opposite. The dense case uses real wall-shaped pairs, and the threshold is
injectable (`maxPairTests`) because with the prefilter in front of it the real
budget is effectively unreachable on honest geometry — and a guard nobody can
reach is a guard nobody can check.
