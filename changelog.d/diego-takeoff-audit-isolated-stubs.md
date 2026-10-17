### Furniture stops being billed as wall

Two phantoms were reported by eye: a lobby bench traced as wall on an ELEVEN03
sheet, and detail linework traced as wall on Camp Bow Wow. To `wallFromPair`
both are walls — two parallel lines a plausible thickness apart is all it can
ask.

What separates them is what they are attached to. A building is connected: a
wall ends on another wall, at a corner or a tee. Furniture, casework, fixtures
and a detail bubble's leader stand on their own.

**Isolation alone is not the rule, and the measurement says why.** A doorway is
a three-foot gap, so a real plan breaks into dozens of islands at a tight
tolerance — on A102 the biggest island at one foot holds 51 of 163 runs, and
`wallsInTheBuilding` joins at twenty feet precisely to avoid that. What
separates them is isolation **and length together**:

| A102 | n | median length | longest |
| --- | --- | --- | --- |
| alone | 41 | 3.3 ft | 8 ft |
| joined | 122 | 7.7 ft | 121 ft |

Every isolated run on that sheet is under eight feet. **Thickness carries no
signal at all** — 5.9 in against 5.8 in — which is worth saying because it is
the obvious thing to reach for.

A long isolated run is deliberately kept: a screen wall or a free-standing
partition is real, and the evidence says nothing about them.

**Removed per sheet**, against both answer-keyed measures improving:

| sheet | before | after | removed |
| --- | --- | --- | --- |
| A101 | 2,776 ft / 190 | 2,570 / 142 | 206 ft, 48 runs |
| A102 | 2,255 / 163 | 2,099 / 122 | 156 ft, 41 |
| A4.B.2 | 2,722 / 336 | 2,529 / 291 | 193 ft, 45 |
| A4.B.1 | 2,603 / 266 | 2,453 / 230 | 150 ft, 36 |
| A4.B.3 | 2,538 / 329 | 2,395 / 293 | 143 ft, 36 |
| A4.B-Y2 | 1,458 / 94 | 1,412 / 76 | 46 ft, 18 |
| A120 | 577 / 82 | 542 / 76 | 35 ft, 6 |

The twenty fixtures went from **13 of 17 within 2% to 15**, and the bench's
cautioned sheets producing phantom walls fell from **31 to 26**. Scale,
type-total accuracy and missed walls all unchanged.

**One limit, stated in the code rather than discovered later:** the gap test
probes four endpoints, so it does not see a true crossing — two runs
intersecting in their middles read as far apart. The first version of that
comment claimed otherwise and a test caught it. It changes no outcome, because
a run is only dropped when it is short, and a short run crossing a wall
mid-span without touching either end is a door swing rather than a wall.

Two censuses were pinning the literal next-function name in the pipeline
(`wallsInTheBuilding(notScaleBar,`) and broke on a stage being inserted. They
now pin what they are actually about — that the scale-bar filter's output is
consumed, and that the building is grouped from the filtered set rather than
the raw one.
