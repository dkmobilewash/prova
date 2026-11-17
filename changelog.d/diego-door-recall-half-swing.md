### A half-circle swing with no leaf, on a wall's line, is a door: Joplin's doors are found (training door recall 80.1% -> 84.5%) (Diego)
`diego/door-recall-half-swing`

Cause 3 of the training miss list (route (a) of the doors work). Joplin A-101 draws each of its doors
140-166 as a 180-degree arc from the jamb with no leaf line, and the finder took only swings of 30
to 110 degrees with a leaf (20 missed key doors on Joplin).

`doorArcCandidates` now takes a 165-195 degree arc with no leaf when all of these hold:
- it is door-sized (2.5 to 4 ft);
- a found wall runs along its diameter;
- its inside is not hatched (15 or more parallel strokes).

The strike is the end over less wall, the opening. A half circle off any wall is not a door, and
neither is the 2020-09-24 set's hatched half-round counter end against a wall: measured, it holds 22
parallel strokes, while Joplin's swings hold at most 10 (their tag pill, a dimension line).

Measured on the training opening table (labels-snap-20261114T0319, plan comparison where the product
pairs): matched key doors 383 -> 404 (Joplin 47 -> 68), false found doors 26 -> 26, no set worse.
Check: `doorWindowSymbols.test.ts` (on a wall, off a wall, too small, too wide, a pill inside, hatch
inside; 7 mutations red).
