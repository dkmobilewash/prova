### Two door-shaped things the finder stops reading as doors: enlarged-plan doors and angle dimensions (Diego's doors fix cycle)
`diego/door-false-causes`

Diego retired the 7 Round-23 sheets from door exams. The exam's 101 false doors were classified from renders:
48 are real doors missing from the frozen key (queued, not edited), and the rest have finder causes the training
sheets never showed. This change fixes two of those causes:

- **A door the product counts has leaves of at most 4.5 ft** (`WIDEST_DOOR_LEAF_FEET`, applied in `doorsInScope`). The finder's arc bound stays at 7 ft, because the scale suggester counts 4.5-7 ft arcs as evidence when it refuses a scale. Preflight caught a first version that lowered the arc bound. No real training leaf reads wider than 4.25 ft. Mack Theater A-101 has a
  1/8in overview plus two 1/4in enlarged plans of the same rooms; the enlarged plans' doors were read at the overview's
  scale and came out 5-6 ft (18 false doors).
- **An angle dimension's word (`110.00°`) inside a single door's swing makes the arc the dimension's.** Radius words
  are deliberately excluded: Substation's `R 3'-0"` sits inside the real door 1118's swing.

Measured on the frozen key, labels-snap-20261117T1555, against main:
- Training: matched 424 -> 424, false 1 -> 1.
- Retired pool: matched 139 -> 139, false 101 -> 80.
- No set worse in either pool.

Bluetooth AI101 and HPL I-110 (non-gating, labels-snap-20261117T1930) are unchanged: 38 false there before and after.

Check: `existingDoors.test.ts`. A 4 ft door is counted and a 5 ft one is not, while its arc is still read. An angle word in the
swing drops the arc; outside it, across the wall, beyond the radius, or a radius word, it does not.
`suggestedScale.test.ts` still refuses on wider arcs. 7 mutations red.
