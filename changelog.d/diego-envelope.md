### It was never finding the outside of the building (Diego)
`diego/envelope`

Scored against the answer key, recall on the floor plans was 72.6% and nobody
knew what the missing 11,591 ft was. Reconciled against the key's by-type truth,
it is almost entirely one thing:

| band | true ft | found | % |
| --- | --- | --- | --- |
| **EXT-1 8-7/8" + EXT-2 8-1/8" — the envelope** | **12,830** | **13** | **0%** |
| A1/A2/C1 partitions | 25,768 | 23,535 | 91% |
| B1 6" stud | 2,411 | 1,326 | 55% |

**Zero per cent of the exterior wall, on every export style.** The shortfall read
as a net 11,591 because 5,174 ft reported at thicknesses matching *no wall type
on the sheet* was partly filling the hole with wrong material.

**The cause is one sentence that was true about the intent and false about the
code.** `inAHatchSeries` rejects a pair when a third parallel stroke "continues
the spacing" — that is what its header has always said. What it actually tested
was whether a third stroke sat anywhere in a RANGE beside the pair.

An exterior wall is not two lines. It is four — outer finish, sheathing, stud
face, inner face — with a 5/8" board line and a column grid line alongside. On a
real sheet the faces sit at 24.52, 24.65, 24.71 and 25.21 ft, the board at 25.26
and the grid at 25.56. Fed those four lines alone the pairer returns the wall
correctly; on the page it returned nothing, because two of those neighbours fall
in the range and the range was the whole test.

Hatching is a REPEATED pattern — this repo's own generator emits it at a
constant pitch — and a wall assembly's layers are not. So the ratio decides: a
series member sits at a whole number of steps from the pair. The board line
lands at 1.07 steps and the grid at 1.51, and neither is a whole number.

**Measured against the key, 60 pages:**

| | before | after |
| --- | --- | --- |
| floor-plan ft found | 30,690 | **40,391** |
| recall | 72.6% | **95.5%** |
| share of output that is not a wall | 34% | **34%** |

That last row is the one that matters. Every previous attempt at recall raised
it by raising phantom faster; this holds the ratio flat while recall moves 23
points.

**Checked on real sets too, which is where the first version of this note would
have been wrong.** The change is far from footage-neutral off the key: Comfort
Inn 25,051 → 37,400 ft (+49%), Grady-Correll 2,424 → 5,726 ft (+136%). A swing
that size on sets with no ground truth is exactly the shape of every false
breakthrough this feature has produced, so it was drawn and counted rather than
believed. The new footage **concentrates**: on Comfort Inn almost all of it
lands in the 7-7/8" band — 6" stud with board both sides, a real assembly — and
does so consistently across four identical typical floors (248→833, 255→837,
251→837, 248→830). Footage within 0.75" of a recognised assembly held at 97-98%
on Comfort Inn and ROSE on Grady, 93% → 96%. Rendered, Grady p20's hatched
area-of-work block is still not striped red: the hatch rejection holds, and the
new red is partitions.

**What it does not fix.** 8 of 22 floor plans now report slightly OVER the true
total, and the envelope band itself is only 1,921 ft of 12,830 — so the
envelope is being found and often measured at the wrong thickness, which prices
it as the wrong assembly. Band accuracy is separate work and this does not claim
it. The viewport-clip pages also read high because the detector sees walls the
clip hides, which is a different defect the key already names.
