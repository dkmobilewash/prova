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

## 4. Not built

- Across sheets. The signature is scale-free but the match is not, so "all
  sheets at the same scale" is one loop over sheets at the same
  `feetPerUnit` with the same template in page-width units; the viewer only
  holds the current sheet's strokes, so it needs a server stage or a sheet
  walk. Left for a round with a customer who asks.
- Text drawn as paths (Topeka) is not ignored; it is matched, which is what
  made "20" and "60" the same symbol at 80%.
- Filled and crossed circles of the same radius tell apart only by the
  fill's extra ink, which the test ignores by design; a density check was
  tried and removed because a hexagon on a hatch is also dense (Bunkie).
