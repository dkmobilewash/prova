### A door leaf drawn inset still counts: Topeka's doors are found (training recall 67.4% -> 74.5%) (Diego)
`diego/door-recall-leaf`

Route (a) of the doors work (Diego): improve the finder's door recall on TRAINING. On Round 23b's
labels it matched 322 of 478 key doors. Every miss got a cause. "Arc fine, leaf not found" was the
second-largest (32 of 156). Topeka and NG Green Bay draw the open leaf inset from the hinge and the
arc's end (a 2.2 ft stroke on a 3 ft swing, about 0.4 ft in at each end), and the leaf test wanted a
stroke the radius' length starting at the hinge.

`doorArcCandidates` now also takes a straight stroke along the hinge-to-end radius: both ends within
0.3 ft of it, starting within 35% of the radius from the hinge, covering 60% of it, and running no
more than 15% past the arc's end or behind the hinge. A dimension or extension line through the hinge
runs on past the arc, and the first cut, without that last condition, took three of them on NG Green
Bay and Topeka.

Measured on the training opening table (labels-snap-20261114T0319, plan comparison where the product
pairs): matched key doors 322 -> 356 (Topeka 81 -> 115), false found doors 29 -> 29, no set worse.
Check: `doorWindowSymbols.test.ts` (the inset leaf, too short a piece, a parallel line off to the
side, a dimension line through the hinge; 4 mutations red).
