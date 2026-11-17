### A door's pen is read off its arc: UCCS's grey exterior doors are set aside (Diego)
`diego/door-pen-arc`

The grey route of the existing-door set-aside (#1196) reads whether a door is drawn in the existing pen.
It read the arc and the "open leaf" together, and on UCCS A2.1.2's east wall the finder's open leaf is
a dash of the dark boundary line along the jamb (3.3 ft on a 3 ft door, so it passes the leaf test).
Doors drawn entirely in grey read 58-74% grey and stayed. `doorPen` now reads the pen off the ARC
alone, the one stroke that is always the door's own; the leaf counts only when no arc stroke is read.

Measured on the training opening table (labels-snap-20261117T1005, plan comparison where the product
pairs, the pair scorer, main + #1204): matched key doors 415 -> 415 of 456, false found doors 25 -> 18
(UCCS 11 -> 6, E Street 1 -> 0, NG Green Bay 1 -> 0), no set worse. On the snapshot before the original
ruled two grey key doors existing (0855) the same change took those two; both are out of the key now.
Check: `existingDoors.test.ts` (a dark line along a grey door's leaf leaves it grey; the leaf's pen
counts with no arc read; the 83%-grey door by its arc pieces; 2 of 3 mutations red, the third only
reorders strokes on both arc and leaf).
