### A hatch is one or two families of lines all along a wall: dimension ticks and fixture crosses are not masonry (Diego)
`diego/hatch-parallel`

On the three training sheets keyed with wall types in round 12, the
remaining wrong types by cause:

| Cause | Wrong ft |
| --- | --- |
| masonry default (B) by note on a non-masonry wall | 117 |
| a variant's tag (A3) on a plain-family wall (A) | 101 |
| family default (A) by note where the plan tags a variant (A3) | 82 |
| another type's tag read on the wall | 21 |
| carried along the wall too far | 21 |
| other note | 15 |

The biggest cause was the hatch test. "All interior masonry partitions are
type B" covers only runs classed hatched, and on Joplin A-101 every hatched
run is drywall in the key. The oblique strokes were dimension ticks, plumbing
fixture crosses and pipe fittings. `hatchedRuns` now also requires:
- the strokes' two commonest angle families (5° wide) to hold 80% of them,
  so cross-hatch still counts;
- the strokes to fall in 70% of the run's one-foot lengths.

Measured on training, on the keyed sheets: typed-correct 1,739 → 1,841 ft
and wrong 343 → 244 ft. Joplin's correct-of-typed goes 79% → 85%; Baker and
Green Bay are unchanged. Across all 43 training sheets, hatched runs go
1,042 → 396, and the only typing that changes is Joplin B → A by the note
(503 ft on p4, p46 and p49). Bunkie's cross-hatched masonry keeps 33 of its
40 hatched runs; sampled losses elsewhere are batt-insulation zigzag. The
hatch flag also feeds "exclude walls like this" as a style, where a wall with
dimension ticks is now the same style as one without.
