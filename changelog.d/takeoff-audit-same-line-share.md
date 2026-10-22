### Two pieces of one wall must agree about its line to within a quarter of its thickness

Bridging a gap allowed a flat inch and a half whatever the wall. Measured on a
held-out library plan by logging every gap decision on the sheet — **150 gaps
bridged and one refused by the corridor guard** — a 78 ft wall lost **7.68 ft**
because its two pieces were **1.60 inches** apart against the 1.50 allowed.
Seven and a half feet of wall to a tenth of an inch.

The same sheet says why it cannot simply be widened. Two other pairs on that
wall sit **3.96 inches** apart and the wall is 8 inches thick, so 3.96 is half
a thickness: one piece measured on the CENTRELINE and the other on a FACE.
Merging those would place the wall half a thickness off its own line.

The bound is a share of the wall's own thickness now, with the old flat value
kept as a floor so nothing tightens. A 4 inch partition gets an inch and a half
as before, a 12 inch block wall gets three inches, and that is the same
sentence rather than two rules.

**Where 0.25 comes from.** The two measurements give a band — above 0.20 of a
thickness, below 0.495 — and the bench chose within it:

| share | allowed on an 8in wall | bench walls missed |
| --- | --- | --- |
| 0.22 | 1.76 in | 111 |
| 0.25 | 2.00 in | 111 |
| 0.30 | 2.40 in | **116** |
| 0.40 | 3.20 in | **116** |

Above a quarter, A-401 starts merging two walls into one run: its in-scope
footage gets slightly better (−1.0% to +0.5%) while a key wall stops being
found as itself. That sheet is drawn at two scales with the scale detected 2×
wrong, so it is the worst place on the bench to spend tolerance. The band came
first and nothing outside it was considered.

**Cedar Hollow — missing 11.99 → 5.07 ft, net −1.7% → −0.7%.** W6 goes from
70.32 to 78.20 against a key of 78.00.

| guard | before | after |
| --- | --- | --- |
| Cedar Hollow | missing 11.99 / extra 0.30 / net −11.70 | **missing 5.07 / extra 0.50 / net −4.57** |
| 20 fixtures | 15 of 17, 3 missed, 2 extra | unchanged |
| bench | 111 missed, 17 of 60, zero-wall PASS | unchanged |
| real sheets | — | six changed, +12 ft on the largest |

The real-sheet changes are almost all one run replacing two, which is the merge
doing its job and moves no footage. The exception is Camp Bow Wow A120, which
gains a run with nothing removed: looked at on the drawing, it is the left-hand
partition of an enlarged toilet room, matching the one already found beside it.
Before and after at `~/Claude Folder/takeoff/shots/step1-before-after.png`.

Mutation-tested four ways, all red. The fourth test exists because "no floor,
share only" survived the first three: a quarter of a 4 inch partition is
TIGHTER than the bound this replaces, so without the floor a wall that merged
before would stop merging — a regression wearing an improvement's clothes.
