### Door-shaped things that are not new doors are not found: grey existing doors, legend samples, callouts and north arrows (Diego)
`diego/door-not-doors`

Four changes to the door finder and one to how doors are scored, measured together on the training
opening table. These are the rule Diego put under the fresh held-out doors exam: the finder with its
set-asides, every door not set aside posted, no score line.

- **A door's pen is read off its arc** (`doorPen`). The grey route (#1196) read the arc and the "open
  leaf" together. On UCCS A2.1.2's east wall the finder's open leaf is a dash of the dark boundary line
  along the jamb, so doors drawn entirely in grey read 58-74% grey and stayed. An arc stroke must have
  BOTH ends on the circle, so a jamb line crossing it with its middle on the circle (the grey pair) is not
  counted. The leaf counts only when no arc stroke is read.
- **A door inside a framed legend is a sample** (`insideLegendBox`, `doorsInScope`). The wall side
  already sets a framed, titled legend aside (`legendBoxes.ts`). Its lines now ride along with the
  existing-wall lines to every door path. A door bounded on three sides by them is dropped: Joplin
  A-101's "NEW DOOR" sample. Three sides, because a frame's top rule is often taken first as its title's
  underline (Joplin's is).
- **An arc whose own circle is at least 240 degrees drawn is a symbol, not a swing** (`circleCoverDegrees`).
  A swing covers at most a half circle. UCCS's interior-elevation callouts (with their numbers read as
  door marks) and Joplin's two north arrows were 7 of the 12 false doors on the Round 25 keys.
- **The door scorer matches a found double door to both leaves' key points** (`doorLabels`; Diego's
  ruling, 2026-11-16, logged before any line or exam number). The key marks one point per leaf.

Measured (training, `labels-snap-20261117T1340`, plan comparison where the product pairs, the pair
scorer). Before = main with the pair scorer; after = this branch:

| | key doors matched | found doors kept | false |
| --- | --- | --- | --- |
| before | 424 / 464 | 414 | 10 |
| **after** | **424 / 464 (91.4%)** | **405** | **1** |

UCCS false 6 -> 0 and Joplin 4 -> 1. No set is worse. The one left is Joplin's fence gate at trash
enclosure 175, a named residual. Every set is at 97% or better (lowest Joplin, 70 of 71).
Check: `existingDoors.test.ts`, `doorWindowSymbols.test.ts`, `openingFeatures.test.ts`; mutations red
for each rule.
