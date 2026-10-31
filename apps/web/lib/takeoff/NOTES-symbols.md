# "Find all like this": symbol counting from the drawn shape

Written 2026-10-29 with the branch that built it (`diego/symbol-count`).
Behind `Company.symbolCountOn`, OFF for every company.

## 1. What it does

On the takeoff, the "Count like this" tool: the estimator drags a box round
one symbol, the sheet's strokes are read the way Find the walls reads them,
and every instance of what is in the box is marked. A click on a mark drops
it; the count is saved as a COUNT measurement, one point per kept match,
named by the estimator — the same row a hand-clicked count makes.

`symbolSignature.ts`: the strokes inside the box, less text-layer words,
less whatever sits out at the box's edges, are the template. The template
is laid over the sheet anchored on one of its heaviest strokes, in each of
the four rigid orientations, wherever a stroke of that length exists, and
scored by how much of its centre-weighted ink lies along a stroke of
comparable length within 12% of its radius. 80% is a match. A first pass
then votes: a template stroke that lands on fewer than half the instances is
context (the jamb a tag straddles) and is dropped, if most of the ink stays.

No model. Rotation and mirroring cost nothing; scale is NOT tolerated by
design — the same block at twice the size is a different fixture family.

## 2. Three versions measured off, before this one

| version | what it did | where it failed |
| --- | --- | --- |
| histograms | lengths/angles/radii of a touching-stroke cluster | Baker's door tag straddles its wall: the cluster is tag + jamb + swing, different at every door — 0 of 18 |
| rigid, per cluster | template laid over each cluster | a hexagon touching Bunkie's hatch was a 1,044-stroke cluster (49 s); tiny arc pieces "lay along" hatch — 192 false circles on Topeka |
| rigid, over a grid, longest-stroke anchor | anchor on the longest template stroke | the longest stroke in a box round a tag is the jamb, and the next door's jamb is a different length — 14 of 18 |

What shipped anchors on the heaviest centre-weighted strokes, skips an anchor
length that more than 2,000 strokes share, tests the heaviest strokes first
so a wrong placement dies in two or three tests, and requires a covering
stroke to be 0.4–2.5× the template stroke's length.

## 3. The five symbols, hand keys, training sheets only

Keys under `~/Claude Folder/takeoff/labels-symbols/<set>/<name>.json`
(outside git), each a list of hand-placed points from crops, a region where
the count was made, and a reach. Baker's key is the 18 door-mark hexagon
positions from the doors key, independent of this code; the other four were
counted by hand on tiles rendered at known coordinates. Topeka's keys were
typed once from a mis-placed render and were wrong; they were rebuilt from
the renders that carry the matches, and two of the circle-X points turned
out to be quartered circles (a different symbol) and were removed.

| sheet | symbol | key | found / missed / false | search |
| --- | --- | --- | --- | --- |
| Baker A101 (15,085 strokes) | door-mark hexagon, straddling its wall | 18 | **18 / 0 / 0** | 0.24 s |
| Bunkie A100 (70,439) | keynote hexagon, any number, in the addition | 21 | **21 / 0 / 0** | 1.2 s |
| Crosslines A100 (37,076) | roof drain, circle in square, roof plan | 17 | **17 / 0 / 0** | 2.6 s |
| Topeka G-100b (263,667) | door-rating bubble (20 and 60), 1st floor east wing | 17 | **17 / 0 / 0** | 14 s (19 s with the unit suite running beside it) |
| Topeka G-100b | circle-X egress symbol, 1st floor | 11 | **11 / 0 / 0** | 1.8 s |

The Bunkie template is the one that proves the centre weighting: the box
brushed the wall hatch and took 1,045 strokes; 37 carried weight, and those
found all 21. The Bunkie W2 window tags are hexagons too and were NOT
matched — they are a different size, and size is not tolerated. Topeka's
bubbles carry their digits as paths, so "20" and "60" differ in one digit;
both match at 80% and would separate at a higher floor.

Honest limits of these numbers: five symbols, four sheets, the keys counted
by the same person who tuned the floor (0.75 → 0.8 was moved on Baker's
five false at 0.75). Topeka's 14 s is the sheet's 263,667 strokes, most of
them a hatch whose pitch matched the bubble's anchor length; the anchor
rarity rule is what brought it from 55 s.

## 4. Round two (2026-10-30, `diego/symbol-count-set`): the trade symbols, and what they taught

Diego's priority after the existing-walls work: make "Count like this"
production-ready for the symbols an MEP estimator actually counts. Hand
keys built on TRAINING sheets by rendering the matches over the drawing and
judging every tile by eye; the keys sit beside the first five under
`~/Claude Folder/takeoff/labels-symbols/`, the renders under
`shots/symbols/`. Every template box was drawn ON THE PLAN, the way the
tool is used; a legend row as a template was tried first and dropped — the
legend's own 2x4 draws its centre dot twice the plan's size, and the centre
weighting makes that dot a quarter of the score.

### 4a. The scores, before and after the rules below

| sheet | symbol | key | first run | after | rule that moved it |
| --- | --- | --- | --- | --- | --- |
| Baker EL1.01 (59,307 strokes) | R1 2x4 troffer, plain and emergency-shaded | 23 | 23 / 0 / **6** | **21 / 2 / 0** | pen agreement; grey background out |
| Baker EL1.01 | OS occupancy sensor (circle reading OS) | 16 | **3** / 13 / 0 | **16 / 0 / 0** | chord anchors; letters inside |
| Baker EL1.01 | X1 exit sign (circle-X) | 5 | 5 / 0 / 0 | 5 / 0 / 0 | — (tag reach widened to keep it) |
| Baker EL1.01 | E2 emergency wall fixture | 7 | 7 / 0 / **6** | **7 / 0 / 0** | type tag beside |
| Baker EL1.01 | R2 plain recessed can | 3 | 3 / 0 / 0 | 3 / 0 / 0 | — |
| Baker EL1.01 | S1 strip light, one unit tick to tick | 7 | 14 (half-unit box) | **7 / 0 / 0** | the box must hold the whole symbol |
| Baker M1.01 (12,975) | CD-1 square diffuser | 17 | 1 (box mis-read) | **17 / 0 / 0** | — |
| Baker EP1.01 (27,014) | duplex receptacle, circle with two lines | ≈72 by eye | 81 (bare circle: every junction box and GFCI) | 4 at the 0.8 floor; **73 at 0.7**, junction circles out | line through the box; the family varies its line length |
| Topeka P111 (138,154) | W&V keyed tag, letters drawn as paths | — | 107, WTR tags among them | 107 | letters-as-paths cannot be read |
| Topeka P111 | water closet in the grey layer under black pipe | — | 1 (itself) | 1 | the box's black ink (the pipe) was taken as the symbol |

Two of Diego's families have no instances to count on the training FP
sheets: Crosslines FP101 and Joplin FP-101 both shade coverage areas and
specify the system in notes — no head is drawn. That is how design-build
sprinkler work is bid; a head count lives on the sprinkler contractor's
shop drawings, not these.

The two troffer misses are drawn differently from the other 21: their black
rectangle is absent and only the grey tile and a filled outline remain
(`shots/symbols/baker-lighting/troffer-R1`). Not a rule's fault.

### 4b. The rules, each measured in before it was written

- **A covering stroke carries the template stroke's pen** (`samePen`: both
  grey or both black, widths within 4x). Every 2x4 fixture sits on a 2x4
  ceiling tile drawn in thin grey; an empty tile, a desk and a pendant's
  outline covered the fixture's black rectangle. Six false in twenty-nine
  became none.
- **Grey under black is background** (`symbolInk`, `BLACK_IS_THE_SYMBOL`
  0.4): the tile under a fixture, the wall hatch round a sensor, are left
  out of the template when black carries 40% of the box's ink. A symbol
  drawn wholly grey keeps every stroke.
- **A circle of micro-pieces gets chord anchors** (`chainChords`): Revit
  draws Baker's sensor as 236 pieces of 0.13‰, under the anchor floor, so
  the only anchors were two grid pieces under it — three of sixteen found.
  Consecutive short pieces are chained and the chord of every minimum-anchor
  length of path is an anchor, and only an anchor; the same block stamps its
  pieces in the same order, so the chords land identically in every copy.
- **A chain is one feature** (`CHAIN_SHARE` 0.5): when straight strokes are
  present, a circle's many pieces may carry at most half the weight, so the
  two lines that tell a receptacle from a junction box keep their say.
- **The letters inside the box are part of the symbol** (`labelInside`):
  OS and PC are the same circle. A NUMBER inside is the instance — door tag
  107, keynote 12 — and asks nothing, which is what keeps the five earlier
  keys whole. Read from the inner half of the box, because the switch-leg
  "a" at a fixture's corner is in the box and not in the symbol.
- **The type tag beside the symbol is part of it** (`tagBeside`,
  `tagsWithin`): E2 and R2 are the identical emergency block; "E2 /INV-1"
  beside one and "R2 /INV-1" beside the other is the only difference. A tag
  is a short schedule code (E2, R1, S1, X1, GFI; one letter alone is not),
  found within four radii or a quarter inch; the template's tag is the
  token the first-pass matches support, so an exit sign's X1 beats the
  switch zone's LV2 written nearer to it; a match passes if any tag-like
  token in reach equals it. A room name there asks nothing.
- **A stroke through the box belongs to it** (`strokesInBox`): the duplex
  receptacle's two lines run a little past the circle; a box drawn snug cut
  them off and the template was a bare circle. Now a stroke no longer than
  the box's diagonal with its midpoint inside is in; a wall through the box
  is not.
- **Overlapping placements of a long symbol are one**
  (`SAME_PLACEMENT_OVERLAP`); and the S1 lesson behind it is written for
  the panel to say some day: a box holding HALF a symbol counts each symbol
  twice, as touching pairs.

### 4c. Across the set

`symbolTemplate` / `findSymbolsFrom` / `scaleSymbolTemplate` split the
matcher so one template is laid over any sheet. The viewer keeps the boxed
symbol and walks the open document page by page in the browser
(`searchAcrossSheets`): the sheet number is read from each page's text
first and pages outside the scope cost only that; in scope, the template is
laid over the sheet at its size on paper, and where both sheets print a
scale and the scales differ the model-space size is tried too and the
larger count kept, said so in the row. `symbolScope.ts` makes the default
scope the sheets whose number starts with the same letter (EL, EP and E are
one discipline). `saveSymbolCountAcrossSheets` writes one count item with a
measurement per sheet, giving a sheet the scale it prints where it has
none and reporting the sheets that print none.

Timed on Baker (65 pages, the troffer template, `symbolSet.eval.ts`):

| scope | sheets walked | total | time | per sheet |
| --- | --- | --- | --- | --- |
| same discipline (E) | 12 of 65 | 26 (21 on EL1.01, 5 legend samples on E0.03) | 2.2 s | 0.19 s |
| every sheet | 65 | 62 (+23 on the RCP A111, +9 on two elevations, +2 each on p10 and M6.01) | 14.5 s | 0.22 s, max 2.0 s |

Which is the case for the default: the elevations' nine are rectangles the
size of a fixture, and the RCP's 23 are the same fixtures counted again.

### 4d. On a scan: not yet, and why

`symbolRaster.eval.ts` rasterises Baker's EL1.01 as the RASTER stage would
(200 dpi, 11 s) and lays the troffer template over the stored lines: 2,182
lines against 59,307 vector strokes, and the troffer's box holds none of
them. The stage's line finder (`rasterLines.ts`) emits axis-aligned bands
of ink at least 0.15 in long — walls — and never a circle, a diagonal or a
mark that short. So "Count like this" on a scanned sheet is OFF the table
until a scan has its own symbol pass over the grey image, and the viewer
should say so rather than offer a box; it does not yet.

## 5. Not built

- A sensitivity control. The duplex family varies its line length 4.95–6.06‰
  across blocks, so the 0.8 floor tuned on door tags keeps 4 of ~72 and 0.7
  keeps 73 with the junction circles out. A "more like this / fewer" knob is
  the honest product answer; the eval takes `SC_COVERAGE`.
- Text drawn as paths (Topeka) still reads as geometry: the W&V tag counts
  the WTR tags with it, because the vote pass keeps what recurs and only the
  letters differ.
- A grey fixture under black pipe (Topeka's water closets): the box's black
  ink is taken as the symbol. A pipe is a long stroke leaving the box; that
  is the discriminator to try.
- The panel's half-symbol warning, and "this is a scan" instead of the box
  tool on a scanned sheet.
- Legend rows as templates: right idea, wrong size on Baker.

## A count needs no scale (2026-10-30, `diego/count-no-scale`)

Chrome was blocked on Baker EL1.01: an electrical sheet with no scale, where
every drawing tool was greyed out. `TakeoffMeasurement.calibrationId` was
required, so a count could not exist there at all, and the across-the-set save
applied printed scales only to give its rows something to point at.

`calibrationId` is now null for a count on an unscaled sheet, and a CHECK keeps
it required for lines and areas. A placeholder calibration was rejected: it
would be a made-up scale, and it would mark the sheet as scaled. The save no
longer applies printed scales, so counting never changes a sheet's scale.

## Chrome's click test, 2026-10-31

Measured on Baker EL1.01. Boxing an OS beside other fixtures gave 1 to 3 "only where it is tagged R1/R2/PC": not a carried tag, but the nearest neighbour's tag applied to a symbol with its own label. A label now wins and no tag is read. Some OS boxes still return 1 or 2, which is box placement, not tags; the ones that catch the circle cleanly return 16.

E0.02's false hits were boxes with XXXXXX across them. A template with nothing printed on it now refuses a match with text overlapping it. E0.03's three to five hits are legend samples and still count; the true fixture count is what EL1.01 says.

`tagBeside` read `made.box` on other sheets, where that box means nothing, so the walk carries `decidedTag` from the boxed sheet.

## Chrome's re-test, 2026-10-31

E0.03 came back 0 where the old list expected 5. Those hits were samples in the sheet's "SYMBOLS LEGEND - LIGHTING" table, not fixtures, so 21 on EL1.01 is the honest count. Nothing was changed for this: with a different box my run still matched 3 there, so a legend sample can still appear, and the row is on screen to be dropped.

Boxing an OS sensor took 12 s against 0.3 s for a troffer. Its circle is 236 arc pieces, and each of 2,770 anchor placements, in four orientations, over two passes, tested them, on every same-size circle on the sheet. Two changes: a spot already matched at 0.9 coverage is not re-tested from its own strokes, and the visit order is kept per weights array rather than sorted per placement. 10.7 s to 4.6 s under the same machine load, the same 16 marks at the same places. Filtering placements to the symbol's letters was tried and removed: it hid the off-label count and only reached 8 s.
