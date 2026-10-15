# Takeoff accuracy bench — scorecard

Mesa Ridge Medical Office Building (fictional, generated). Every number below is the product's own pipeline run on a PDF this bench wrote, graded against an answer key computed from the model — never from the PDF. Regenerate with `TAKEOFF_BENCH=1 pnpm takeoff:bench`.

Main set: **70 cases** across 11 sheets and 17 export variants, two PDF producers (hand-written raw PDF; Chromium/Skia from SVG). Holdout: 20 seeded plans, reported separately in HOLDOUT.md.

## Against the pass bar

| Bar | Result | Detail |
| --- | --- | --- |
| Scale: 100% correct or honestly undetermined, zero wrong-but-confident | ❌ FAIL | 63/70 cases correct or declined; **7 wrong-but-confident**: A-101__half-11x17 (1/8" = 1'-0"), A-101__half-archB-outlines (1/8" = 1'-0"), A-401__clean (1/4" = 1'-0"), A-401__revit (1/4" = 1'-0"), A-401__autocad (1/4" = 1'-0"), A-401__skia (1/4" = 1'-0"), A-401__layers (1/4" = 1'-0") |
| In-scope wall LF within 2% per type (clean, Revit, AutoCAD, Skia) | ❌ FAIL | 28 of 60 type-totals outside ±2%; worst: A-101__clean/D1 31.3%, A-101__revit/D1 31.3%, A-101__autocad/D1 30.6%, A-101__skia/D1 30.6% |
| Zero-wall sheets: 0 phantom LF | ❌ FAIL | 11 of 36 zero-wall cases produced walls: A-111__clean 2314 ft, A-111__revit 2274 ft, A-111__autocad 2406 ft, A-111__skia 2335 ft, A-111__layers 2314 ft, M-101__clean 2268 ft, M-101__revit 2257 ft, M-101__autocad 2164 ft, M-101__skia 2159 ft, M-101__layers 2268 ft, M-101__plot-black 2268 ft |
| No wall over 10 ft missed entirely | ❌ FAIL | 27 cases miss at least one; 115 walls in total |
| Scanned sheet refuses with a clear message | 🟡 PARTIAL — the scale refusal is clear; the wall finder's is not | scale: "This sheet is a scan, so there are no printed dimensions to read a scale from."; walls: 0 path operators, so the finder returns nothing and the viewer says "No walls found on this sheet. That is a fact about the drawing, not a failure." |

## Mechanism probes — one heuristic, the smallest input that shows it

Each probe calls the product function directly with nothing else on the page. ❌ = a confirmed defect, with the product's own output.

| | Probe | Heuristic / code path | Input | Correct answer | Product says |
| --- | --- | --- | --- | --- | --- |
| ✅ | P1 | control | one 20' A1 wall, two faces | 20.0 ft | 20.0 ft |
| ✅ | P2 | inAHatchSeries (SERIES_REACH 2.5) | the same wall + a gridline 8" off its centreline (parallel, 70' long) | 20.0 ft — a gridline is not a third wall face | 20.0 ft |
| ✅ | P3 | inAHatchSeries — no length floor on the third line | the same wall + one 6"-long tick parallel to it, 7" off centre (a tag edge, a door-leaf end, a letter) | 20.0 ft | 20.0 ft |
| ✅ | P4 | duplicate strokes (wallsFromBothEngines + mergeWalls) | the same wall with every face stroked twice (fill boundary + stroke, a Revit habit) | 20.0 ft | 20.0 ft |
| ✅ | P5 | one-face-one-use + 3x face ratio at a T junction | 30' wall whose top face is broken at 10' by a branch (5" gap), bottom face continuous | ~29.6-30 ft | 30.0 ft |
| ❌ | P6 | minThicknessFeet 0.2 | 20' of F1 furring, 1-1/2" (hat channel + 5/8" board) | 20.0 ft | 0.0 ft |
| ✅ | P7 | sheetStrokes CTM: Form XObject /Matrix | a 360pt wall face drawn inside a Form XObject whose /Matrix is [1/8 0 0 1/8 …] (AutoCAD block) | 360 pt | 360.0 pt (plain: 360.0 pt) |
| ✅ | P8 | sheetStrokes ignores optional content | a wall on an optional-content layer that is OFF | 0 segments | 0 segments |
| ❌ | P9 | sheetStrokes ignores the clip path | the 360pt wall under a clip that shows only x < 200 | faces of at most 100pt; the clip rectangle is not geometry | 6 segments, longest 792.0 pt |
| ❌ | P10 | sheetStrokes ignores the dash pattern | a wall drawn dashed (existing to be demolished) | recognisably not a solid wall | 2 solid segments of 360 pt |
| ❌ | P11 | scaleFromPrinted half-size guard (standardSheetSize) | title block says 1/8" on an 18x12 page (an ARCH D printed at exactly half size) | decline — half of ARCH D is ARCH B, so the page size cannot prove full size | returns 1/8" = 1'-0" (2x wrong on every quantity) |
| ❌ | P12 | scaleFromPrinted half-size guard | title block says 1/8" on an 11x17 page (ARCH D fitted to tabloid) | decline | returns 1/8" = 1'-0" (2.12x wrong) |
| ❌ | P13 | scale vote counts DISTINCT label text | eight 30'-0" bay dimensions, each exactly 270pt (1/8") | 1/8" = 1'-0" (eight independent agreeing dimensions) | declines: Only 1 printed dimension on this sheet agree on a scale — too few to set one from. |
| ❌ | P14 | clusterByThickness (CLUSTER_INCHES 0.5) | an A1 partition (4-7/8") and a C1 shaft wall (4-3/4") | two groups — different assemblies, different prices | 1 group(s) |
| ❌ | P15 | postMeasuredWallRun sums an accepted group into ONE run | ten separate 10' walls accepted as one found-walls group | 90 studs (each run has its own end stud) | 76 studs |
| ✅ | P16 | layerNames: another discipline's line never reaches the pairer | a 20' A1 wall + a column-grid line at exactly 2 face-spacings, on S-GRID | 2 of the 3 segments reach the pairer, and it still returns 20.0 ft | 2 of 3 segments reach it, 20.0 ft (footage UNCHANGED here — see the note in probes.ts) |
| ✅ | P17 | layerNames: furniture and the title block are not walls | three identical 20' wall shapes, on A-FURN, on G-ANNO-TTLB and on A-WALL | 20.0 ft — only the one the drawing calls a wall | 20.0 ft with layers, 60.0 ft without |
| ✅ | P18 | layerNames: the filter may never empty a sheet | a sheet whose ONLY geometry is on a layer the vocabulary calls furniture | 20.0 ft — drop nothing rather than everything | 20.0 ft |

## Scorecard — one row per case, worst first

LF columns are feet of in-scope wall the sheet should yield, measured at the TRUE scale (detection alone), centreline convention. `face` is what a perfect two-face pair-finder could claim (the overlap of the two drawn faces — junctions and openings removed); both conventions are reported because an estimator measures centrelines and the geometry only supports faces.

| # | Case | Producer | Scale expected | Scale got | Walls found/partial/missed of counted | LF found / key CL (face) | Error vs CL | Phantom (n / ft) | Must-not-count ft | Out-of-scope ft | Double ft | Targets |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | A-101__half-11x17 | raw | decline (no scale) | ❌ 1/8" = 1'-0" (title block) — WRONG | 45/0/3 of 48 | 2131 / 2165 (1894) | -1.6% | 27 / 144 | 0 | 18 | 27 | scale vote snap (2%), printed-scale fallback sheet-size guard (ANSI B is a 'standard' size) |
| 2 | A-101__half-archB-outlines | raw | LEVEL 1 FLOOR PLAN: 1/16" = 1'-0" | ❌ 1/8" = 1'-0" (title block) — WRONG | 45/0/3 of 48 | 2147 / 2165 (1894) | -0.8% | 41 / 211 | 0 | 0 | 27 | printed-scale fallback when no dimension can be read on a half-size print |
| 3 | A-401__autocad | raw | ENLARGED RESTROOMS: 1/4" = 1'-0"; ENLARGED STAIR: 1/2" = 1'-0" | ❌ 1/4" = 1'-0" — WRONG | 10/1/1 of 12 | 348 / 370 (339) | -5.8% | 7 / 119 | 0 | 0 | 0 | sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm` |
| 4 | A-401__clean | raw | ENLARGED RESTROOMS: 1/4" = 1'-0"; ENLARGED STAIR: 1/2" = 1'-0" | ❌ 1/4" = 1'-0" — WRONG | 10/1/1 of 12 | 348 / 370 (339) | -5.8% | 7 / 119 | 0 | 0 | 0 | baseline: every heuristic on well-formed input |
| 5 | A-401__revit | raw | ENLARGED RESTROOMS: 1/4" = 1'-0"; ENLARGED STAIR: 1/2" = 1'-0" | ❌ 1/4" = 1'-0" — WRONG | 10/1/1 of 12 | 348 / 370 (339) | -5.8% | 6 / 101 | 0 | 0 | 0 | wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces |
| 6 | A-401__layers | raw | ENLARGED RESTROOMS: 1/4" = 1'-0"; ENLARGED STAIR: 1/2" = 1'-0" | ❌ 1/4" = 1'-0" — WRONG | 10/1/1 of 12 | 348 / 370 (339) | -5.8% | 7 / 119 | 0 | 0 | 0 | layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over |
| 7 | A-401__skia | skia | ENLARGED RESTROOMS: 1/4" = 1'-0"; ENLARGED STAIR: 1/2" = 1'-0" | ❌ 1/4" = 1'-0" — WRONG | 10/1/1 of 12 | 381 / 370 (339) | 3.0% | 6 / 116 | 0 | 0 | 33 | a second, unrelated PDF writer's structure |
| 8 | A-111__autocad | raw | LEVEL 1 RCP: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 21 / 2406 | 0 | 0 | 0 | sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm` |
| 9 | A-111__skia | skia | LEVEL 1 RCP: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 15 / 2335 | 0 | 0 | 0 | a second, unrelated PDF writer's structure |
| 10 | A-111__clean | raw | LEVEL 1 RCP: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 12 / 2314 | 0 | 0 | 0 | baseline: every heuristic on well-formed input |
| 11 | A-111__layers | raw | LEVEL 1 RCP: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 12 / 2314 | 0 | 0 | 0 | layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over |
| 12 | A-111__revit | raw | LEVEL 1 RCP: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 14 / 2274 | 0 | 0 | 0 | wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces |
| 13 | M-101__clean | raw | LEVEL 1 MECHANICAL PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" (title block) | — | — | — | 10 / 2268 | 0 | 0 | 0 | baseline: every heuristic on well-formed input |
| 14 | M-101__layers | raw | LEVEL 1 MECHANICAL PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" (title block) | — | — | — | 10 / 2268 | 0 | 0 | 0 | layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over |
| 15 | M-101__plot-black | raw | LEVEL 1 MECHANICAL PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" (title block) | — | — | — | 10 / 2268 | 0 | 0 | 0 | control — nothing in the shipped pipeline reads the pen since #671 |
| 16 | M-101__revit | raw | LEVEL 1 MECHANICAL PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" (title block) | — | — | — | 11 / 2257 | 0 | 0 | 0 | wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces |
| 17 | M-101__autocad | raw | LEVEL 1 MECHANICAL PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" (title block) | — | — | — | 12 / 2164 | 0 | 0 | 0 | sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm` |
| 18 | M-101__skia | skia | LEVEL 1 MECHANICAL PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" (title block) | — | — | — | 8 / 2159 | 0 | 0 | 0 | a second, unrelated PDF writer's structure |
| 19 | A-101__scan | raw | decline (a scan: no vector strokes, no text layer) | ⚪ declined | 0/0/48 of 48 | 0 / 2165 (1894) | -100.0% | 0 / 0 | 0 | 0 | 0 | no vector strokes, no text layer: the honest refusal |
| 20 | A-101__clip | raw | LEVEL 1 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 33/0/2 of 35 | 1702 / 1437 (1250) | 18.4% | 5 / 53 | 441 | 0 | 23 | sheetStrokes ignores clipping (W n) and reads the clip rectangle itself as four segments |
| 21 | A-102__clip | raw | LEVEL 2 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 21/0/1 of 22 | 1327 / 1113 (1030) | 19.2% | 4 / 44 | 378 | 0 | 6 | sheetStrokes ignores clipping (W n) and reads the clip rectangle itself as four segments |
| 22 | A-101__shx | raw | decline (lettering saved as line work: no readable dimensions) | 🟡 declined, wrong reason | 45/0/3 of 48 | 2147 / 2165 (1894) | -0.8% | 56 / 280 | 0 | 0 | 27 | dimensionLabels has nothing to read; hasTextLayer; wallsNotLettering has no text boxes |
| 23 | A-101__ocg | raw | LEVEL 1 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 45/0/3 of 48 | 2147 / 2165 (1894) | -0.8% | 4 / 48 | 47 | 0 | 27 | getOperatorList returns hidden optional content; sheetStrokes does not read OC state |
| 24 | A-101__dashed | raw | LEVEL 1 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 45/0/3 of 48 | 2147 / 2165 (1894) | -0.8% | 4 / 48 | 46 | 0 | 27 | sheetStrokes ignores the dash pattern: a dashed wall reads as a solid one |
| 25 | A-101-REV1__clean | raw | LEVEL 1 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 39/1/7 of 47 | 2104 / 2145 (1875) | -1.9% | 4 / 48 | 0 | 0 | 27 | baseline: every heuristic on well-formed input |
| 26 | A-101__revit | raw | LEVEL 1 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 45/0/3 of 48 | 2132 / 2165 (1894) | -1.5% | 4 / 33 | 0 | 0 | 27 | wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces |
| 27 | A-101__skia | skia | LEVEL 1 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 45/0/3 of 48 | 2147 / 2165 (1894) | -0.8% | 9 / 65 | 0 | 0 | 27 | a second, unrelated PDF writer's structure |
| 28 | A-101__autocad | raw | LEVEL 1 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 45/0/3 of 48 | 2147 / 2165 (1894) | -0.8% | 15 / 89 | 0 | 0 | 27 | sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm` |
| 29 | A-101__autocad-flat | raw | LEVEL 1 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 45/0/3 of 48 | 2147 / 2165 (1894) | -0.8% | 5 / 53 | 0 | 0 | 27 | the curved wall as chords (does pairing recover it?); exploded linetypes (dash segments vs the 2 ft input floor); isolates these from the Form /Matrix defect |
| 30 | A-101__half-archB | raw | LEVEL 1 FLOOR PLAN: 1/16" = 1'-0" | ✅ 1/16" = 1'-0" | 45/0/3 of 48 | 2147 / 2165 (1894) | -0.8% | 4 / 48 | 0 | 0 | 27 | printed-scale half-size guard: half of ARCH D IS a standard sheet (ARCH B) |
| 31 | A-101__clean | raw | LEVEL 1 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 45/0/3 of 48 | 2147 / 2165 (1894) | -0.8% | 4 / 48 | 0 | 0 | 27 | baseline: every heuristic on well-formed input |
| 32 | A-101__rotate | raw | LEVEL 1 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 45/0/3 of 48 | 2147 / 2165 (1894) | -0.8% | 4 / 48 | 0 | 0 | 27 | viewport transform with rotation and a CropBox origin; content outside the CropBox |
| 33 | A-101__overridden-dims | raw | LEVEL 1 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 45/0/3 of 48 | 2147 / 2165 (1894) | -0.8% | 4 / 48 | 0 | 0 | 27 | scale vote: distinct labels, 3 to agree, 2x margin over the runner-up |
| 34 | A-101__layers | raw | LEVEL 1 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 45/0/3 of 48 | 2147 / 2165 (1894) | -0.8% | 4 / 48 | 0 | 0 | 27 | layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over |
| 35 | A-101__plot-black | raw | LEVEL 1 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 45/0/3 of 48 | 2147 / 2165 (1894) | -0.8% | 4 / 48 | 0 | 0 | 27 | control — nothing in the shipped pipeline reads the pen since #671 |
| 36 | A-401__half-11x17 | raw | decline (no scale) | ⚪ declined | 10/1/1 of 12 | 348 / 370 (339) | -5.9% | 10 / 128 | 0 | 0 | 0 | scale vote snap (2%), printed-scale fallback sheet-size guard (ANSI B is a 'standard' size) |
| 37 | A-401__overridden-dims | raw | ENLARGED RESTROOMS: 1/4" = 1'-0"; ENLARGED STAIR: 1/2" = 1'-0" | ⚪ declined | 10/1/1 of 12 | 348 / 370 (339) | -5.8% | 7 / 119 | 0 | 0 | 0 | scale vote: distinct labels, 3 to agree, 2x margin over the runner-up |
| 38 | A-102__revit | raw | LEVEL 2 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 29/0/2 of 31 | 1652 / 1658 (1545) | -0.4% | 3 / 39 | 0 | 48 | 5 | wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces |
| 39 | A-102__skia | skia | LEVEL 2 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 29/0/2 of 31 | 1654 / 1658 (1545) | -0.3% | 3 / 39 | 0 | 47 | 0 | a second, unrelated PDF writer's structure |
| 40 | A-102__autocad | raw | LEVEL 2 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 29/0/2 of 31 | 1654 / 1658 (1545) | -0.3% | 8 / 54 | 0 | 47 | 0 | sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm` |
| 41 | A-102__autocad-flat | raw | LEVEL 2 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 29/0/2 of 31 | 1654 / 1658 (1545) | -0.3% | 3 / 39 | 0 | 47 | 0 | the curved wall as chords (does pairing recover it?); exploded linetypes (dash segments vs the 2 ft input floor); isolates these from the Form /Matrix defect |
| 42 | A-102__clean | raw | LEVEL 2 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 29/0/2 of 31 | 1662 / 1658 (1545) | 0.2% | 3 / 39 | 0 | 47 | 10 | baseline: every heuristic on well-formed input |
| 43 | A-102__layers | raw | LEVEL 2 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 29/0/2 of 31 | 1662 / 1658 (1545) | 0.2% | 3 / 39 | 0 | 47 | 10 | layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over |
| 44 | A-102__rotate | raw | LEVEL 2 FLOOR PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | 29/0/2 of 31 | 1662 / 1658 (1545) | 0.2% | 3 / 39 | 0 | 47 | 10 | viewport transform with rotation and a CropBox origin; content outside the CropBox |
| 45 | A-102__half-archB | raw | LEVEL 2 FLOOR PLAN: 1/16" = 1'-0" | ✅ 1/16" = 1'-0" | 29/0/2 of 31 | 1662 / 1658 (1545) | 0.2% | 3 / 39 | 0 | 47 | 10 | printed-scale half-size guard: half of ARCH D IS a standard sheet (ARCH B) |
| 46 | G-001__clean | raw | decline (no scale) | ⚪ declined | — | — | — | 0 / 0 | 0 | 0 | 0 | baseline: every heuristic on well-formed input |
| 47 | G-001__revit | raw | decline (no scale) | ⚪ declined | — | — | — | 0 / 0 | 0 | 0 | 0 | wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces |
| 48 | G-001__autocad | raw | decline (no scale) | ⚪ declined | — | — | — | 0 / 0 | 0 | 0 | 0 | sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm` |
| 49 | G-001__skia | skia | decline (no scale) | ⚪ declined | — | — | — | 0 / 0 | 0 | 0 | 0 | a second, unrelated PDF writer's structure |
| 50 | G-001__layers | raw | decline (no scale) | ⚪ declined | — | — | — | 0 / 0 | 0 | 0 | 0 | layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over |
| 51 | A-201__clean | raw | ELEVATIONS: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 0 / 0 | 0 | 0 | 0 | baseline: every heuristic on well-formed input |
| 52 | A-201__revit | raw | ELEVATIONS: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 0 / 0 | 0 | 0 | 0 | wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces |
| 53 | A-201__autocad | raw | ELEVATIONS: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 0 / 0 | 0 | 0 | 0 | sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm` |
| 54 | A-201__skia | skia | ELEVATIONS: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 0 / 0 | 0 | 0 | 0 | a second, unrelated PDF writer's structure |
| 55 | A-201__layers | raw | ELEVATIONS: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 0 / 0 | 0 | 0 | 0 | layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over |
| 56 | A-501__clean | raw | PARTITION TYPES: 3" = 1'-0" | ✅ 3" = 1'-0" (title block) | — | — | — | 0 / 0 | 0 | 0 | 0 | baseline: every heuristic on well-formed input |
| 57 | A-501__revit | raw | PARTITION TYPES: 3" = 1'-0" | ✅ 3" = 1'-0" (title block) | — | — | — | 0 / 0 | 0 | 0 | 0 | wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces |
| 58 | A-501__autocad | raw | PARTITION TYPES: 3" = 1'-0" | ✅ 3" = 1'-0" (title block) | — | — | — | 0 / 0 | 0 | 0 | 0 | sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm` |
| 59 | A-501__skia | skia | PARTITION TYPES: 3" = 1'-0" | ✅ 3" = 1'-0" (title block) | — | — | — | 0 / 0 | 0 | 0 | 0 | a second, unrelated PDF writer's structure |
| 60 | A-501__layers | raw | PARTITION TYPES: 3" = 1'-0" | ✅ 3" = 1'-0" (title block) | — | — | — | 0 / 0 | 0 | 0 | 0 | layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over |
| 61 | A-601__clean | raw | decline (no scale) | ⚪ declined | — | — | — | 0 / 0 | 0 | 0 | 0 | baseline: every heuristic on well-formed input |
| 62 | A-601__revit | raw | decline (no scale) | ⚪ declined | — | — | — | 0 / 0 | 0 | 0 | 0 | wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces |
| 63 | A-601__autocad | raw | decline (no scale) | ⚪ declined | — | — | — | 0 / 0 | 0 | 0 | 0 | sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm` |
| 64 | A-601__skia | skia | decline (no scale) | ⚪ declined | — | — | — | 0 / 0 | 0 | 0 | 0 | a second, unrelated PDF writer's structure |
| 65 | A-601__layers | raw | decline (no scale) | ⚪ declined | — | — | — | 0 / 0 | 0 | 0 | 0 | layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over |
| 66 | S-101__clean | raw | LEVEL 2 FRAMING PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 0 / 0 | 0 | 0 | 0 | baseline: every heuristic on well-formed input |
| 67 | S-101__revit | raw | LEVEL 2 FRAMING PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 0 / 0 | 0 | 0 | 0 | wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces |
| 68 | S-101__autocad | raw | LEVEL 2 FRAMING PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 0 / 0 | 0 | 0 | 0 | sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm` |
| 69 | S-101__skia | skia | LEVEL 2 FRAMING PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 0 / 0 | 0 | 0 | 0 | a second, unrelated PDF writer's structure |
| 70 | S-101__layers | raw | LEVEL 2 FRAMING PLAN: 1/8" = 1'-0" | ✅ 1/8" = 1'-0" | — | — | — | 0 / 0 | 0 | 0 | 0 | layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over |

## Findings per case, worst first

**A-101__half-11x17** — LEVEL 1 FLOOR PLAN; scale vote snap (2%), printed-scale fallback sheet-size guard (ANSI B is a 'standard' size)

- SCALE WRONG_PRINTED: named 1/8" = 1'-0" for the whole page — LEVEL 1 FLOOR PLAN is not a standard scale. Code path: pageInventory → scaleFromPrinted (standardSheetSize treats the reduced page as full size)
- 27 phantom runs, 144 ft — wall (A-WALL): 72 ft; door (A-DOOR): 54 ft; stair (A-FLOR-STRS): 18 ft
- in-scope LF 2131 of 2165 (centreline) = -1.6%; 3 walls missed outright, 0 partial
    - 53 ft lost over 2 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 33 ft lost over 2 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
    - 18 ft lost over 1 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 11 ft lost over 1 walls — wallFromPair face-length ratio: its two faces are drawn at unequal lengths — one face broken at junctions/openings, the other continuous
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- END TO END the offered scale is 0.472x the truth: 488 ft reported against 2165 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__half-11x17.png`

**A-101__half-archB-outlines** — LEVEL 1 FLOOR PLAN; printed-scale fallback when no dimension can be read on a half-size print

- SCALE WRONG_PRINTED: named 1/8" = 1'-0" for the whole page — LEVEL 1 FLOOR PLAN is 1/16" = 1'-0". Code path: pageInventory → scaleFromPrinted (standardSheetSize treats the reduced page as full size)
- 41 phantom runs, 211 ft — text (A-ANNO-TEXT): 84 ft; dimtext (A-ANNO-DIMS): 45 ft; stair (A-FLOR-STRS): 36 ft
- in-scope LF 2147 of 2165 (centreline) = -0.8%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- END TO END the offered scale is 0.500x the truth: 978 ft reported against 2165 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__half-archB-outlines.png`

**A-401__autocad** — ENLARGED PLANS AND DETAILS; sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm`

- SCALE ZONE: ENLARGED STAIR would be measured at the offered scale: every length 2.00x the truth — the page carries more than one scale and the offer names one, with no zone warning
- SCALE WRONG_CONFIDENT: named 1/4" = 1'-0" for the whole page — ENLARGED STAIR is 1/2" = 1'-0". Code path: readSheetScale/scaleFromDimensions picks one scale per PAGE
- 7 phantom runs, 119 ft — detail (A-DETL): 64 ft; stair (A-FLOR-STRS): 36 ft; dim (A-ANNO-DIMS): 16 ft
- in-scope LF 348 of 370 (centreline) = -5.8%; 1 walls missed outright, 1 partial
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 15 ft lost over 1 walls — wallsFromStrokes series test (inAHatchSeries): the type is drawn as several parallel lines, so every pair of its faces has a third line continuing the spacing
    - 2 ft lost over 1 walls — every face piece is under the 2 ft minimum run (wallsFromStrokes' input floor)
- overlay: `overlays/A-401__autocad.png`

**A-401__clean** — ENLARGED PLANS AND DETAILS; baseline: every heuristic on well-formed input

- SCALE ZONE: ENLARGED STAIR would be measured at the offered scale: every length 2.00x the truth — the page carries more than one scale and the offer names one, with no zone warning
- SCALE WRONG_CONFIDENT: named 1/4" = 1'-0" for the whole page — ENLARGED STAIR is 1/2" = 1'-0". Code path: readSheetScale/scaleFromDimensions picks one scale per PAGE
- 7 phantom runs, 119 ft — detail (A-DETL): 64 ft; stair (A-FLOR-STRS): 36 ft; dim (A-ANNO-DIMS): 16 ft
- in-scope LF 348 of 370 (centreline) = -5.8%; 1 walls missed outright, 1 partial
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 15 ft lost over 1 walls — wallsFromStrokes series test (inAHatchSeries): the type is drawn as several parallel lines, so every pair of its faces has a third line continuing the spacing
    - 2 ft lost over 1 walls — every face piece is under the 2 ft minimum run (wallsFromStrokes' input floor)
- overlay: `overlays/A-401__clean.png`

**A-401__revit** — ENLARGED PLANS AND DETAILS; wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces

- SCALE ZONE: ENLARGED STAIR would be measured at the offered scale: every length 2.00x the truth — the page carries more than one scale and the offer names one, with no zone warning
- SCALE WRONG_CONFIDENT: named 1/4" = 1'-0" for the whole page — ENLARGED STAIR is 1/2" = 1'-0". Code path: readSheetScale/scaleFromDimensions picks one scale per PAGE
- 6 phantom runs, 101 ft — detail (A-DETL): 64 ft; stair (A-FLOR-STRS): 18 ft; dim (A-ANNO-DIMS): 16 ft
- in-scope LF 348 of 370 (centreline) = -5.8%; 1 walls missed outright, 1 partial
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 17 ft lost over 2 walls — every face piece is under the 2 ft minimum run (wallsFromStrokes' input floor)
- overlay: `overlays/A-401__revit.png`

**A-401__layers** — ENLARGED PLANS AND DETAILS; layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over

- SCALE ZONE: ENLARGED STAIR would be measured at the offered scale: every length 2.00x the truth — the page carries more than one scale and the offer names one, with no zone warning
- SCALE WRONG_CONFIDENT: named 1/4" = 1'-0" for the whole page — ENLARGED STAIR is 1/2" = 1'-0". Code path: readSheetScale/scaleFromDimensions picks one scale per PAGE
- 7 phantom runs, 119 ft — detail (A-DETL): 64 ft; stair (A-FLOR-STRS): 36 ft; dim (A-ANNO-DIMS): 16 ft
- in-scope LF 348 of 370 (centreline) = -5.8%; 1 walls missed outright, 1 partial
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 15 ft lost over 1 walls — wallsFromStrokes series test (inAHatchSeries): the type is drawn as several parallel lines, so every pair of its faces has a third line continuing the spacing
    - 2 ft lost over 1 walls — every face piece is under the 2 ft minimum run (wallsFromStrokes' input floor)
- overlay: `overlays/A-401__layers.png`

**A-401__skia** — ENLARGED PLANS AND DETAILS; a second, unrelated PDF writer's structure

- SCALE ZONE: ENLARGED STAIR would be measured at the offered scale: every length 2.00x the truth — the page carries more than one scale and the offer names one, with no zone warning
- SCALE WRONG_CONFIDENT: named 1/4" = 1'-0" for the whole page — ENLARGED STAIR is 1/2" = 1'-0". Code path: readSheetScale/scaleFromDimensions picks one scale per PAGE
- 6 phantom runs, 116 ft — detail (A-DETL): 64 ft; stair (A-FLOR-STRS): 36 ft; dim (A-ANNO-DIMS): 16 ft
- in-scope LF 381 of 370 (centreline) = 3.0%; 1 walls missed outright, 1 partial
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 15 ft lost over 1 walls — wallsFromStrokes series test (inAHatchSeries): the type is drawn as several parallel lines, so every pair of its faces has a third line continuing the spacing
    - 2 ft lost over 1 walls — every face piece is under the 2 ft minimum run (wallsFromStrokes' input floor)
- 33 ft counted twice on the same wall (overlapping runs)
- overlay: `overlays/A-401__skia.png`

**A-111__autocad** — LEVEL 1 REFLECTED CEILING PLAN; sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm`

- ZERO-WALL SHEET produced 2406 ft (71 runs) — on ceilinggrid (A-CLNG-GRID): 117 ft; soffit (A-CLNG-SOFF): 82 ft; grid (S-GRID): 67 ft; 2061 ft are walls repeated from the floor plan
- overlay: `overlays/A-111__autocad.png`

**A-111__skia** — LEVEL 1 REFLECTED CEILING PLAN; a second, unrelated PDF writer's structure

- ZERO-WALL SHEET produced 2335 ft (68 runs) — on soffit (A-CLNG-SOFF): 73 ft; ceilinggrid (A-CLNG-GRID): 68 ft; grid (S-GRID): 67 ft; 2062 ft are walls repeated from the floor plan
- overlay: `overlays/A-111__skia.png`

**A-111__clean** — LEVEL 1 REFLECTED CEILING PLAN; baseline: every heuristic on well-formed input

- ZERO-WALL SHEET produced 2314 ft (66 runs) — on grid (S-GRID): 123 ft; soffit (A-CLNG-SOFF): 73 ft; ceilinggrid (A-CLNG-GRID): 64 ft; 2002 ft are walls repeated from the floor plan
- overlay: `overlays/A-111__clean.png`

**A-111__layers** — LEVEL 1 REFLECTED CEILING PLAN; layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over

- ZERO-WALL SHEET produced 2314 ft (66 runs) — on grid (S-GRID): 123 ft; soffit (A-CLNG-SOFF): 73 ft; ceilinggrid (A-CLNG-GRID): 64 ft; 2002 ft are walls repeated from the floor plan
- overlay: `overlays/A-111__layers.png`

**A-111__revit** — LEVEL 1 REFLECTED CEILING PLAN; wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces

- ZERO-WALL SHEET produced 2274 ft (68 runs) — on grid (S-GRID): 123 ft; soffit (A-CLNG-SOFF): 78 ft; ceilinggrid (A-CLNG-GRID): 64 ft; 1954 ft are walls repeated from the floor plan
- overlay: `overlays/A-111__revit.png`

**M-101__clean** — LEVEL 1 MECHANICAL PLAN; baseline: every heuristic on well-formed input

- ZERO-WALL SHEET produced 2268 ft (64 runs) — on duct (M-DUCT): 63 ft; grid (S-GRID): 59 ft; wall (A-WALL): 26 ft; 2116 ft are walls repeated from the floor plan
- scale right only by the title-block fallback: the 0 printed dimensions did not pair with their lines (1405 segments read)
- overlay: `overlays/M-101__clean.png`

**M-101__layers** — LEVEL 1 MECHANICAL PLAN; layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over

- ZERO-WALL SHEET produced 2268 ft (64 runs) — on duct (M-DUCT): 63 ft; grid (S-GRID): 59 ft; wall (A-WALL): 26 ft; 2116 ft are walls repeated from the floor plan
- scale right only by the title-block fallback: the 0 printed dimensions did not pair with their lines (1405 segments read)
- overlay: `overlays/M-101__layers.png`

**M-101__plot-black** — LEVEL 1 MECHANICAL PLAN; control — nothing in the shipped pipeline reads the pen since #671

- ZERO-WALL SHEET produced 2268 ft (64 runs) — on duct (M-DUCT): 63 ft; grid (S-GRID): 59 ft; wall (A-WALL): 26 ft; 2116 ft are walls repeated from the floor plan
- scale right only by the title-block fallback: the 0 printed dimensions did not pair with their lines (1405 segments read)
- overlay: `overlays/M-101__plot-black.png`

**M-101__revit** — LEVEL 1 MECHANICAL PLAN; wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces

- ZERO-WALL SHEET produced 2257 ft (65 runs) — on duct (M-DUCT): 63 ft; grid (S-GRID): 59 ft; wall (A-WALL): 26 ft; 2103 ft are walls repeated from the floor plan
- scale right only by the title-block fallback: the 0 printed dimensions did not pair with their lines (2885 segments read)
- overlay: `overlays/M-101__revit.png`

**M-101__autocad** — LEVEL 1 MECHANICAL PLAN; sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm`

- ZERO-WALL SHEET produced 2164 ft (64 runs) — on door (A-DOOR): 30 ft; duct (M-DUCT): 18 ft; 2116 ft are walls repeated from the floor plan
- scale right only by the title-block fallback: the 0 printed dimensions did not pair with their lines (2303 segments read)
- overlay: `overlays/M-101__autocad.png`

**M-101__skia** — LEVEL 1 MECHANICAL PLAN; a second, unrelated PDF writer's structure

- ZERO-WALL SHEET produced 2159 ft (63 runs) — on duct (M-DUCT): 28 ft; door (A-DOOR): 15 ft; 2116 ft are walls repeated from the floor plan
- scale right only by the title-block fallback: the 0 printed dimensions did not pair with their lines (4158 segments read)
- overlay: `overlays/M-101__skia.png`

**A-101__scan** — LEVEL 1 FLOOR PLAN; no vector strokes, no text layer: the honest refusal

- No vector strokes: wall finder returns nothing; the viewer's message would be "No walls found… a fact about the drawing" — true of the file, misleading about the building
- in-scope LF 0 of 2165 (centreline) = -100.0%; 48 walls missed outright, 0 partial
    - 2210 ft lost over 50 walls — the reader returned no segment on this wall's faces — its geometry never reached wallsFromStrokes
    - 23 ft lost over 1 walls — sheetStrokes skips curveTo: a curved wall has no straight faces to pair
- curved wall: 0.0 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__scan.png`

**A-101__clip** — LEVEL 1 FLOOR PLAN; sheetStrokes ignores clipping (W n) and reads the clip rectangle itself as four segments

- 5 phantom runs, 53 ft — stair (A-FLOR-STRS): 36 ft; wall (A-WALL): 9 ft; dim (A-ANNO-DIMS): 5 ft
- 441 ft counted that must not be: outside the viewport clip (441 ft)
- in-scope LF 1702 of 1437 (centreline) = 18.4%; 2 walls missed outright, 0 partial
    - 53 ft lost over 2 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 23 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 1437 ft, net of openings 1297 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 1620 SF of board above doors and above/below windows
- overlay: `overlays/A-101__clip.png`

**A-102__clip** — LEVEL 2 FLOOR PLAN; sheetStrokes ignores clipping (W n) and reads the clip rectangle itself as four segments

- 4 phantom runs, 44 ft — stair (A-FLOR-STRS): 36 ft; wall (A-WALL): 5 ft; door (A-DOOR): 3 ft
- 378 ft counted that must not be: outside the viewport clip (378 ft)
- in-scope LF 1327 of 1113 (centreline) = 19.2%; 1 walls missed outright, 0 partial
    - 23 ft lost over 1 walls — wallsFromStrokes one-face-one-use: the faces are broken into pieces (openings, T junctions, columns) and the long piece is spent on one partner, stranding the rest
- 6 ft counted twice on the same wall (overlapping runs)
- openings: key gross 1113 ft, net of openings 1052 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 646 SF of board above doors and above/below windows
- overlay: `overlays/A-102__clip.png`

**A-101__shx** — LEVEL 1 FLOOR PLAN; dimensionLabels has nothing to read; hasTextLayer; wallsNotLettering has no text boxes

- SCALE declined with the wrong reason — says: "This sheet is a scan, so there are no printed dimensions to read a scale from."
- 56 phantom runs, 280 ft — text (A-ANNO-TEXT): 84 ft; titleblock (G-ANNO-TTLB): 69 ft; dimtext (A-ANNO-DIMS): 45 ft
- in-scope LF 2147 of 2165 (centreline) = -0.8%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__shx.png`

**A-101__ocg** — LEVEL 1 FLOOR PLAN; getOperatorList returns hidden optional content; sheetStrokes does not read OC state

- 4 phantom runs, 48 ft — stair (A-FLOR-STRS): 36 ft; wall (A-WALL): 9 ft; door (A-DOOR): 3 ft
- 47 ft counted that must not be: on an optional-content layer that is OFF (47 ft)
- in-scope LF 2147 of 2165 (centreline) = -0.8%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__ocg.png`

**A-101__dashed** — LEVEL 1 FLOOR PLAN; sheetStrokes ignores the dash pattern: a dashed wall reads as a solid one

- 4 phantom runs, 48 ft — stair (A-FLOR-STRS): 36 ft; wall (A-WALL): 9 ft; door (A-DOOR): 3 ft
- 46 ft counted that must not be: existing to be demolished (dashed) (46 ft)
- in-scope LF 2147 of 2165 (centreline) = -0.8%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__dashed.png`

**A-101-REV1__clean** — LEVEL 1 FLOOR PLAN; baseline: every heuristic on well-formed input

- 4 phantom runs, 48 ft — stair (A-FLOR-STRS): 36 ft; wall (A-WALL): 9 ft; door (A-DOOR): 3 ft
- in-scope LF 2104 of 2145 (centreline) = -1.9%; 7 walls missed outright, 1 partial
    - 75 ft lost over 4 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 59 ft lost over 2 walls — wallsFromStrokes one-face-one-use: the faces are broken into pieces (openings, T junctions, columns) and the long piece is spent on one partner, stranding the rest
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 47 ft lost over 1 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — dim (A-ANNO-DIMS)
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2145 ft, net of openings 1947 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101-REV1__clean.png`

**A-101__revit** — LEVEL 1 FLOOR PLAN; wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces

- 4 phantom runs, 33 ft — stair (A-FLOR-STRS): 18 ft; wall (A-WALL): 9 ft; door (A-DOOR): 3 ft
- in-scope LF 2132 of 2165 (centreline) = -1.5%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: the faces are broken into pieces (openings, T junctions, columns) and the long piece is spent on one partner, stranding the rest
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__revit.png`

**A-101__skia** — LEVEL 1 FLOOR PLAN; a second, unrelated PDF writer's structure

- 9 phantom runs, 65 ft — stair (A-FLOR-STRS): 36 ft; door (A-DOOR): 15 ft; wall (A-WALL): 14 ft
- in-scope LF 2147 of 2165 (centreline) = -0.8%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__skia.png`

**A-101__autocad** — LEVEL 1 FLOOR PLAN; sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm`

- 15 phantom runs, 89 ft — stair (A-FLOR-STRS): 36 ft; door (A-DOOR): 30 ft; wall (A-WALL): 23 ft
- in-scope LF 2147 of 2165 (centreline) = -0.8%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__autocad.png`

**A-101__autocad-flat** — LEVEL 1 FLOOR PLAN; the curved wall as chords (does pairing recover it?); exploded linetypes (dash segments vs the 2 ft input floor); isolates these from the Form /Matrix defect

- 5 phantom runs, 53 ft — stair (A-FLOR-STRS): 36 ft; wall (A-WALL): 14 ft; door (A-DOOR): 3 ft
- in-scope LF 2147 of 2165 (centreline) = -0.8%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__autocad-flat.png`

**A-101__half-archB** — LEVEL 1 FLOOR PLAN; printed-scale half-size guard: half of ARCH D IS a standard sheet (ARCH B)

- 4 phantom runs, 48 ft — stair (A-FLOR-STRS): 36 ft; wall (A-WALL): 9 ft; door (A-DOOR): 3 ft
- in-scope LF 2147 of 2165 (centreline) = -0.8%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__half-archB.png`

**A-101__clean** — LEVEL 1 FLOOR PLAN; baseline: every heuristic on well-formed input

- 4 phantom runs, 48 ft — stair (A-FLOR-STRS): 36 ft; wall (A-WALL): 9 ft; door (A-DOOR): 3 ft
- in-scope LF 2147 of 2165 (centreline) = -0.8%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__clean.png`

**A-101__rotate** — LEVEL 1 FLOOR PLAN; viewport transform with rotation and a CropBox origin; content outside the CropBox

- 4 phantom runs, 48 ft — stair (A-FLOR-STRS): 36 ft; wall (A-WALL): 9 ft; door (A-DOOR): 3 ft
- in-scope LF 2147 of 2165 (centreline) = -0.8%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__rotate.png`

**A-101__overridden-dims** — LEVEL 1 FLOOR PLAN; scale vote: distinct labels, 3 to agree, 2x margin over the runner-up

- 4 phantom runs, 48 ft — stair (A-FLOR-STRS): 36 ft; wall (A-WALL): 9 ft; door (A-DOOR): 3 ft
- in-scope LF 2147 of 2165 (centreline) = -0.8%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__overridden-dims.png`

**A-101__layers** — LEVEL 1 FLOOR PLAN; layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over

- 4 phantom runs, 48 ft — stair (A-FLOR-STRS): 36 ft; wall (A-WALL): 9 ft; door (A-DOOR): 3 ft
- in-scope LF 2147 of 2165 (centreline) = -0.8%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__layers.png`

**A-101__plot-black** — LEVEL 1 FLOOR PLAN; control — nothing in the shipped pipeline reads the pen since #671

- 4 phantom runs, 48 ft — stair (A-FLOR-STRS): 36 ft; wall (A-WALL): 9 ft; door (A-DOOR): 3 ft
- in-scope LF 2147 of 2165 (centreline) = -0.8%; 3 walls missed outright, 0 partial
    - 64 ft lost over 3 walls — wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 20 ft lost over 1 walls — only one face reached the reader, or the faces came back too close — under wallFromPair's 0.2 ft (2.4") thickness floor
- 27 ft counted twice on the same wall (overlapping runs)
- curved wall: 22.8 of 23.0 ft
- openings: key gross 2165 ft, net of openings 1966 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 2321 SF of board above doors and above/below windows
- overlay: `overlays/A-101__plot-black.png`

**A-401__half-11x17** — ENLARGED PLANS AND DETAILS; scale vote snap (2%), printed-scale fallback sheet-size guard (ANSI B is a 'standard' size)

- 10 phantom runs, 128 ft — detail (A-DETL): 64 ft; dim (A-ANNO-DIMS): 34 ft; stair (A-FLOR-STRS): 18 ft
- in-scope LF 348 of 370 (centreline) = -5.9%; 1 walls missed outright, 1 partial
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 15 ft lost over 1 walls — wallsFromStrokes series test (inAHatchSeries): the type is drawn as several parallel lines, so every pair of its faces has a third line continuing the spacing
    - 2 ft lost over 1 walls — every face piece is under the 2 ft minimum run (wallsFromStrokes' input floor)
- overlay: `overlays/A-401__half-11x17.png`

**A-401__overridden-dims** — ENLARGED PLANS AND DETAILS; scale vote: distinct labels, 3 to agree, 2x margin over the runner-up

- 7 phantom runs, 119 ft — detail (A-DETL): 64 ft; stair (A-FLOR-STRS): 36 ft; dim (A-ANNO-DIMS): 16 ft
- in-scope LF 348 of 370 (centreline) = -5.8%; 1 walls missed outright, 1 partial
    - 49 ft lost over 2 walls — wallsFromStrokes series test (inAHatchSeries): a a parallel line continues the face spacing — wall (A-WALL)
    - 15 ft lost over 1 walls — wallsFromStrokes series test (inAHatchSeries): the type is drawn as several parallel lines, so every pair of its faces has a third line continuing the spacing
    - 2 ft lost over 1 walls — every face piece is under the 2 ft minimum run (wallsFromStrokes' input floor)
- overlay: `overlays/A-401__overridden-dims.png`

**A-102__revit** — LEVEL 2 FLOOR PLAN; wallsFromStrokes: each face used once (duplicates pair with each other's partners), overlap >= 50% of the shorter face, 2ft input floor on pieces

- 3 phantom runs, 39 ft — stair (A-FLOR-STRS): 36 ft; door (A-DOOR): 3 ft
- in-scope LF 1652 of 1658 (centreline) = -0.4%; 2 walls missed outright, 0 partial
    - 81 ft lost over 2 walls — wallsFromStrokes one-face-one-use: the faces are broken into pieces (openings, T junctions, columns) and the long piece is spent on one partner, stranding the rest
- 5 ft counted twice on the same wall (overlapping runs)
- openings: key gross 1658 ft, net of openings 1580 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 786 SF of board above doors and above/below windows
- overlay: `overlays/A-102__revit.png`

**A-102__skia** — LEVEL 2 FLOOR PLAN; a second, unrelated PDF writer's structure

- 3 phantom runs, 39 ft — stair (A-FLOR-STRS): 36 ft; door (A-DOOR): 3 ft
- in-scope LF 1654 of 1658 (centreline) = -0.3%; 2 walls missed outright, 0 partial
    - 81 ft lost over 2 walls — wallsFromStrokes one-face-one-use: the faces are broken into pieces (openings, T junctions, columns) and the long piece is spent on one partner, stranding the rest
- openings: key gross 1658 ft, net of openings 1580 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 786 SF of board above doors and above/below windows
- overlay: `overlays/A-102__skia.png`

**A-102__autocad** — LEVEL 2 FLOOR PLAN; sheetStrokes CTM stack: Form XObject /Matrix arrives as paintFormXObjectBegin, not as a `cm`

- 8 phantom runs, 54 ft — stair (A-FLOR-STRS): 36 ft; door (A-DOOR): 18 ft
- in-scope LF 1654 of 1658 (centreline) = -0.3%; 2 walls missed outright, 0 partial
    - 81 ft lost over 2 walls — wallsFromStrokes one-face-one-use: the faces are broken into pieces (openings, T junctions, columns) and the long piece is spent on one partner, stranding the rest
- openings: key gross 1658 ft, net of openings 1580 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 786 SF of board above doors and above/below windows
- overlay: `overlays/A-102__autocad.png`

**A-102__autocad-flat** — LEVEL 2 FLOOR PLAN; the curved wall as chords (does pairing recover it?); exploded linetypes (dash segments vs the 2 ft input floor); isolates these from the Form /Matrix defect

- 3 phantom runs, 39 ft — stair (A-FLOR-STRS): 36 ft; door (A-DOOR): 3 ft
- in-scope LF 1654 of 1658 (centreline) = -0.3%; 2 walls missed outright, 0 partial
    - 81 ft lost over 2 walls — wallsFromStrokes one-face-one-use: the faces are broken into pieces (openings, T junctions, columns) and the long piece is spent on one partner, stranding the rest
- openings: key gross 1658 ft, net of openings 1580 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 786 SF of board above doors and above/below windows
- overlay: `overlays/A-102__autocad-flat.png`

**A-102__clean** — LEVEL 2 FLOOR PLAN; baseline: every heuristic on well-formed input

- 3 phantom runs, 39 ft — stair (A-FLOR-STRS): 36 ft; door (A-DOOR): 3 ft
- in-scope LF 1662 of 1658 (centreline) = 0.2%; 2 walls missed outright, 0 partial
    - 81 ft lost over 2 walls — wallsFromStrokes one-face-one-use: the faces are broken into pieces (openings, T junctions, columns) and the long piece is spent on one partner, stranding the rest
- 10 ft counted twice on the same wall (overlapping runs)
- openings: key gross 1658 ft, net of openings 1580 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 786 SF of board above doors and above/below windows
- overlay: `overlays/A-102__clean.png`

**A-102__layers** — LEVEL 2 FLOOR PLAN; layerNames: the drawing says which lines are walls. The title block (G-ANNO-TTLB), the column grid (S-GRID), the ducts (M-DUCT), the ceiling grid (A-CLNG-GRID) and the furniture (A-FURN) are all nameable, and the grid is what the series test trips over

- 3 phantom runs, 39 ft — stair (A-FLOR-STRS): 36 ft; door (A-DOOR): 3 ft
- in-scope LF 1662 of 1658 (centreline) = 0.2%; 2 walls missed outright, 0 partial
    - 81 ft lost over 2 walls — wallsFromStrokes one-face-one-use: the faces are broken into pieces (openings, T junctions, columns) and the long piece is spent on one partner, stranding the rest
- 10 ft counted twice on the same wall (overlapping runs)
- openings: key gross 1658 ft, net of openings 1580 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 786 SF of board above doors and above/below windows
- overlay: `overlays/A-102__layers.png`

**A-102__rotate** — LEVEL 2 FLOOR PLAN; viewport transform with rotation and a CropBox origin; content outside the CropBox

- 3 phantom runs, 39 ft — stair (A-FLOR-STRS): 36 ft; door (A-DOOR): 3 ft
- in-scope LF 1662 of 1658 (centreline) = 0.2%; 2 walls missed outright, 0 partial
    - 81 ft lost over 2 walls — wallsFromStrokes one-face-one-use: the faces are broken into pieces (openings, T junctions, columns) and the long piece is spent on one partner, stranding the rest
- 10 ft counted twice on the same wall (overlapping runs)
- openings: key gross 1658 ft, net of openings 1580 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 786 SF of board above doors and above/below windows
- overlay: `overlays/A-102__rotate.png`

**A-102__half-archB** — LEVEL 2 FLOOR PLAN; printed-scale half-size guard: half of ARCH D IS a standard sheet (ARCH B)

- 3 phantom runs, 39 ft — stair (A-FLOR-STRS): 36 ft; door (A-DOOR): 3 ft
- in-scope LF 1662 of 1658 (centreline) = 0.2%; 2 walls missed outright, 0 partial
    - 81 ft lost over 2 walls — wallsFromStrokes one-face-one-use: the faces are broken into pieces (openings, T junctions, columns) and the long piece is spent on one partner, stranding the rest
- 10 ft counted twice on the same wall (overlapping runs)
- openings: key gross 1658 ft, net of openings 1580 ft; found runs stop at jambs, so found LF is NET — and LF × height then drops 786 SF of board above doors and above/below windows
- overlay: `overlays/A-102__half-archB.png`

## In-scope LF by wall type (bid sheets)

| Case | Type | Key CL ft | Key face ft | Found ft | Error vs CL | Error vs face |
| --- | --- | --- | --- | --- | --- | --- |
| A-101__clean | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__clean | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__clean | A1 | 1099.9 | 960.7 | 1021.6 | -7.1% | 6.3% |
| A-101__clean | A2 | 203.0 | 189.2 | 252.7 | 24.5% | 33.6% |
| A-101__clean | B1 | 148.7 | 135.1 | 147.1 | -1.1% | 8.9% |
| A-101__clean | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__clean | C1 | 26.7 | 25.5 | 25.4 | -4.8% | -0.4% |
| A-101__clean | D1 | 33.0 | 32.6 | 43.3 | 31.3% | 32.9% |
| A-101__revit | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__revit | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__revit | A1 | 1099.9 | 960.7 | 1007.9 | -8.4% | 4.9% |
| A-101__revit | A2 | 203.0 | 189.2 | 251.4 | 23.9% | 32.9% |
| A-101__revit | B1 | 148.7 | 135.1 | 146.8 | -1.2% | 8.7% |
| A-101__revit | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__revit | C1 | 26.7 | 25.5 | 25.1 | -5.7% | -1.4% |
| A-101__revit | D1 | 33.0 | 32.6 | 43.3 | 31.3% | 32.9% |
| A-101__autocad | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__autocad | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__autocad | A1 | 1099.9 | 960.7 | 1021.7 | -7.1% | 6.4% |
| A-101__autocad | A2 | 203.0 | 189.2 | 252.7 | 24.5% | 33.6% |
| A-101__autocad | B1 | 148.7 | 135.1 | 146.7 | -1.3% | 8.6% |
| A-101__autocad | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__autocad | C1 | 26.7 | 25.5 | 25.4 | -4.8% | -0.4% |
| A-101__autocad | D1 | 33.0 | 32.6 | 43.1 | 30.6% | 32.2% |
| A-101__autocad-flat | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__autocad-flat | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__autocad-flat | A1 | 1099.9 | 960.7 | 1021.7 | -7.1% | 6.4% |
| A-101__autocad-flat | A2 | 203.0 | 189.2 | 252.7 | 24.5% | 33.6% |
| A-101__autocad-flat | B1 | 148.7 | 135.1 | 146.7 | -1.3% | 8.6% |
| A-101__autocad-flat | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__autocad-flat | C1 | 26.7 | 25.5 | 25.4 | -4.8% | -0.4% |
| A-101__autocad-flat | D1 | 33.0 | 32.6 | 43.1 | 30.6% | 32.2% |
| A-101__shx | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__shx | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__shx | A1 | 1099.9 | 960.7 | 1021.6 | -7.1% | 6.3% |
| A-101__shx | A2 | 203.0 | 189.2 | 252.7 | 24.5% | 33.6% |
| A-101__shx | B1 | 148.7 | 135.1 | 147.1 | -1.1% | 8.9% |
| A-101__shx | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__shx | C1 | 26.7 | 25.5 | 25.4 | -4.8% | -0.4% |
| A-101__shx | D1 | 33.0 | 32.6 | 43.3 | 31.3% | 32.9% |
| A-101__rotate | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__rotate | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__rotate | A1 | 1099.9 | 960.7 | 1021.6 | -7.1% | 6.3% |
| A-101__rotate | A2 | 203.0 | 189.2 | 252.7 | 24.5% | 33.6% |
| A-101__rotate | B1 | 148.7 | 135.1 | 147.1 | -1.1% | 8.9% |
| A-101__rotate | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__rotate | C1 | 26.7 | 25.5 | 25.4 | -4.8% | -0.4% |
| A-101__rotate | D1 | 33.0 | 32.6 | 43.3 | 31.3% | 32.9% |
| A-101__half-11x17 | EXT-1 | 395.3 | 332.8 | 373.0 | -5.7% | 12.1% |
| A-101__half-11x17 | EXT-2 | 208.7 | 170.1 | 235.2 | 12.7% | 38.3% |
| A-101__half-11x17 | A1 | 1099.9 | 960.7 | 1006.0 | -8.5% | 4.7% |
| A-101__half-11x17 | A2 | 203.0 | 189.2 | 252.5 | 24.4% | 33.5% |
| A-101__half-11x17 | B1 | 148.7 | 135.1 | 147.0 | -1.1% | 8.9% |
| A-101__half-11x17 | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__half-11x17 | C1 | 26.7 | 25.5 | 25.4 | -4.6% | -0.2% |
| A-101__half-11x17 | D1 | 33.0 | 32.6 | 43.2 | 31.0% | 32.7% |
| A-101__half-archB | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__half-archB | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__half-archB | A1 | 1099.9 | 960.7 | 1021.6 | -7.1% | 6.3% |
| A-101__half-archB | A2 | 203.0 | 189.2 | 252.7 | 24.5% | 33.6% |
| A-101__half-archB | B1 | 148.7 | 135.1 | 147.1 | -1.1% | 8.9% |
| A-101__half-archB | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__half-archB | C1 | 26.7 | 25.5 | 25.4 | -4.8% | -0.4% |
| A-101__half-archB | D1 | 33.0 | 32.6 | 43.3 | 31.3% | 32.9% |
| A-101__half-archB-outlines | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__half-archB-outlines | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__half-archB-outlines | A1 | 1099.9 | 960.7 | 1021.6 | -7.1% | 6.3% |
| A-101__half-archB-outlines | A2 | 203.0 | 189.2 | 252.7 | 24.5% | 33.6% |
| A-101__half-archB-outlines | B1 | 148.7 | 135.1 | 147.1 | -1.1% | 8.9% |
| A-101__half-archB-outlines | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__half-archB-outlines | C1 | 26.7 | 25.5 | 25.4 | -4.8% | -0.4% |
| A-101__half-archB-outlines | D1 | 33.0 | 32.6 | 43.3 | 31.3% | 32.9% |
| A-101__overridden-dims | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__overridden-dims | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__overridden-dims | A1 | 1099.9 | 960.7 | 1021.6 | -7.1% | 6.3% |
| A-101__overridden-dims | A2 | 203.0 | 189.2 | 252.7 | 24.5% | 33.6% |
| A-101__overridden-dims | B1 | 148.7 | 135.1 | 147.1 | -1.1% | 8.9% |
| A-101__overridden-dims | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__overridden-dims | C1 | 26.7 | 25.5 | 25.4 | -4.8% | -0.4% |
| A-101__overridden-dims | D1 | 33.0 | 32.6 | 43.3 | 31.3% | 32.9% |
| A-101__ocg | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__ocg | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__ocg | A1 | 1099.9 | 960.7 | 1021.6 | -7.1% | 6.3% |
| A-101__ocg | A2 | 203.0 | 189.2 | 252.7 | 24.5% | 33.6% |
| A-101__ocg | B1 | 148.7 | 135.1 | 147.1 | -1.1% | 8.9% |
| A-101__ocg | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__ocg | C1 | 26.7 | 25.5 | 25.4 | -4.8% | -0.4% |
| A-101__ocg | D1 | 33.0 | 32.6 | 43.3 | 31.3% | 32.9% |
| A-101__layers | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__layers | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__layers | A1 | 1099.9 | 960.7 | 1021.6 | -7.1% | 6.3% |
| A-101__layers | A2 | 203.0 | 189.2 | 252.7 | 24.5% | 33.6% |
| A-101__layers | B1 | 148.7 | 135.1 | 147.1 | -1.1% | 8.9% |
| A-101__layers | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__layers | C1 | 26.7 | 25.5 | 25.4 | -4.8% | -0.4% |
| A-101__layers | D1 | 33.0 | 32.6 | 43.3 | 31.3% | 32.9% |
| A-101__clip | EXT-1 | 234.0 | 190.7 | 280.6 | 19.9% | 47.1% |
| A-101__clip | EXT-2 | 140.7 | 112.7 | 230.7 | 64.0% | 104.8% |
| A-101__clip | A1 | 814.9 | 717.0 | 893.9 | 9.7% | 24.7% |
| A-101__clip | A2 | 160.0 | 153.9 | 210.1 | 31.3% | 36.5% |
| A-101__clip | B1 | 87.3 | 75.4 | 86.6 | -0.9% | 14.8% |
| A-101__dashed | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__dashed | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__dashed | A1 | 1099.9 | 960.7 | 1021.6 | -7.1% | 6.3% |
| A-101__dashed | A2 | 203.0 | 189.2 | 252.7 | 24.5% | 33.6% |
| A-101__dashed | B1 | 148.7 | 135.1 | 147.1 | -1.1% | 8.9% |
| A-101__dashed | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__dashed | C1 | 26.7 | 25.5 | 25.4 | -4.8% | -0.4% |
| A-101__dashed | D1 | 33.0 | 32.6 | 43.3 | 31.3% | 32.9% |
| A-101__plot-black | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__plot-black | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__plot-black | A1 | 1099.9 | 960.7 | 1021.6 | -7.1% | 6.3% |
| A-101__plot-black | A2 | 203.0 | 189.2 | 252.7 | 24.5% | 33.6% |
| A-101__plot-black | B1 | 148.7 | 135.1 | 147.1 | -1.1% | 8.9% |
| A-101__plot-black | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__plot-black | C1 | 26.7 | 25.5 | 25.4 | -4.8% | -0.4% |
| A-101__plot-black | D1 | 33.0 | 32.6 | 43.3 | 31.3% | 32.9% |
| A-101__scan | EXT-1 | 395.3 | 332.8 | 0.0 | -100.0% | -100.0% |
| A-101__scan | EXT-2 | 208.7 | 170.1 | 0.0 | -100.0% | -100.0% |
| A-101__scan | A1 | 1099.9 | 960.7 | 0.0 | -100.0% | -100.0% |
| A-101__scan | A2 | 203.0 | 189.2 | 0.0 | -100.0% | -100.0% |
| A-101__scan | B1 | 148.7 | 135.1 | 0.0 | -100.0% | -100.0% |
| A-101__scan | F1 | 49.4 | 48.2 | 0.0 | -100.0% | -100.0% |
| A-101__scan | C1 | 26.7 | 25.5 | 0.0 | -100.0% | -100.0% |
| A-101__scan | D1 | 33.0 | 32.6 | 0.0 | -100.0% | -100.0% |
| A-101__skia | EXT-1 | 395.3 | 332.8 | 373.2 | -5.6% | 12.1% |
| A-101__skia | EXT-2 | 208.7 | 170.1 | 235.3 | 12.8% | 38.3% |
| A-101__skia | A1 | 1099.9 | 960.7 | 1021.7 | -7.1% | 6.3% |
| A-101__skia | A2 | 203.0 | 189.2 | 252.7 | 24.5% | 33.6% |
| A-101__skia | B1 | 148.7 | 135.1 | 146.7 | -1.3% | 8.6% |
| A-101__skia | F1 | 49.4 | 48.2 | 48.6 | -1.7% | 0.8% |
| A-101__skia | C1 | 26.7 | 25.5 | 25.3 | -5.1% | -0.7% |
| A-101__skia | D1 | 33.0 | 32.6 | 43.1 | 30.6% | 32.2% |
| A-102__clean | EXT-1 | 395.3 | 373.7 | 400.7 | 1.4% | 7.2% |
| A-102__clean | EXT-2 | 208.7 | 186.1 | 208.1 | -0.3% | 11.8% |
| A-102__clean | A1 | 846.0 | 782.0 | 847.0 | 0.1% | 8.3% |
| A-102__clean | A2 | 107.7 | 104.9 | 107.0 | -0.7% | 2.0% |
| A-102__clean | B1 | 44.0 | 42.8 | 44.0 | -0.1% | 2.7% |
| A-102__clean | C1 | 26.7 | 25.6 | 25.5 | -4.5% | -0.6% |
| A-102__clean | D1 | 30.0 | 29.6 | 30.0 | 0.1% | 1.4% |
| A-102__revit | EXT-1 | 395.3 | 373.7 | 400.7 | 1.4% | 7.2% |
| A-102__revit | EXT-2 | 208.7 | 186.1 | 208.1 | -0.3% | 11.8% |
| A-102__revit | A1 | 846.0 | 782.0 | 838.3 | -0.9% | 7.2% |
| A-102__revit | A2 | 107.7 | 104.9 | 106.2 | -1.3% | 1.3% |
| A-102__revit | B1 | 44.0 | 42.8 | 43.8 | -0.5% | 2.3% |
| A-102__revit | C1 | 26.7 | 25.6 | 25.3 | -5.3% | -1.4% |
| A-102__revit | D1 | 30.0 | 29.6 | 29.8 | -0.7% | 0.7% |
| A-102__autocad | EXT-1 | 395.3 | 373.7 | 396.0 | 0.2% | 6.0% |
| A-102__autocad | EXT-2 | 208.7 | 186.1 | 208.2 | -0.2% | 11.9% |
| A-102__autocad | A1 | 846.0 | 782.0 | 843.1 | -0.3% | 7.8% |
| A-102__autocad | A2 | 107.7 | 104.9 | 107.6 | -0.1% | 2.5% |
| A-102__autocad | B1 | 44.0 | 42.8 | 43.8 | -0.5% | 2.3% |
| A-102__autocad | C1 | 26.7 | 25.6 | 25.5 | -4.5% | -0.6% |
| A-102__autocad | D1 | 30.0 | 29.6 | 29.8 | -0.6% | 0.8% |
| A-102__skia | EXT-1 | 395.3 | 373.7 | 396.0 | 0.2% | 6.0% |
| A-102__skia | EXT-2 | 208.7 | 186.1 | 208.2 | -0.2% | 11.9% |
| A-102__skia | A1 | 846.0 | 782.0 | 843.1 | -0.3% | 7.8% |
| A-102__skia | A2 | 107.7 | 104.9 | 107.6 | -0.1% | 2.5% |
| A-102__skia | B1 | 44.0 | 42.8 | 43.8 | -0.5% | 2.3% |
| A-102__skia | C1 | 26.7 | 25.6 | 25.4 | -4.8% | -0.9% |
| A-102__skia | D1 | 30.0 | 29.6 | 29.8 | -0.6% | 0.8% |
| A-102__layers | EXT-1 | 395.3 | 373.7 | 400.7 | 1.4% | 7.2% |
| A-102__layers | EXT-2 | 208.7 | 186.1 | 208.1 | -0.3% | 11.8% |
| A-102__layers | A1 | 846.0 | 782.0 | 847.0 | 0.1% | 8.3% |
| A-102__layers | A2 | 107.7 | 104.9 | 107.0 | -0.7% | 2.0% |
| A-102__layers | B1 | 44.0 | 42.8 | 44.0 | -0.1% | 2.7% |
| A-102__layers | C1 | 26.7 | 25.6 | 25.5 | -4.5% | -0.6% |
| A-102__layers | D1 | 30.0 | 29.6 | 30.0 | 0.1% | 1.4% |
| A-102__autocad-flat | EXT-1 | 395.3 | 373.7 | 396.0 | 0.2% | 6.0% |
| A-102__autocad-flat | EXT-2 | 208.7 | 186.1 | 208.2 | -0.2% | 11.9% |
| A-102__autocad-flat | A1 | 846.0 | 782.0 | 843.1 | -0.3% | 7.8% |
| A-102__autocad-flat | A2 | 107.7 | 104.9 | 107.6 | -0.1% | 2.5% |
| A-102__autocad-flat | B1 | 44.0 | 42.8 | 43.8 | -0.5% | 2.3% |
| A-102__autocad-flat | C1 | 26.7 | 25.6 | 25.5 | -4.5% | -0.6% |
| A-102__autocad-flat | D1 | 30.0 | 29.6 | 29.8 | -0.6% | 0.8% |
| A-102__rotate | EXT-1 | 395.3 | 373.7 | 400.7 | 1.4% | 7.2% |
| A-102__rotate | EXT-2 | 208.7 | 186.1 | 208.1 | -0.3% | 11.8% |
| A-102__rotate | A1 | 846.0 | 782.0 | 847.0 | 0.1% | 8.3% |
| A-102__rotate | A2 | 107.7 | 104.9 | 107.0 | -0.7% | 2.0% |
| A-102__rotate | B1 | 44.0 | 42.8 | 44.0 | -0.1% | 2.7% |
| A-102__rotate | C1 | 26.7 | 25.6 | 25.5 | -4.5% | -0.6% |
| A-102__rotate | D1 | 30.0 | 29.6 | 30.0 | 0.1% | 1.4% |
| A-102__clip | EXT-1 | 234.0 | 217.3 | 302.0 | 29.0% | 39.0% |
| A-102__clip | EXT-2 | 140.7 | 122.8 | 208.1 | 47.9% | 69.5% |
| A-102__clip | A1 | 634.0 | 587.2 | 708.3 | 11.7% | 20.6% |
| A-102__clip | A2 | 64.7 | 63.7 | 64.3 | -0.5% | 1.0% |
| A-102__clip | B1 | 40.0 | 39.0 | 44.0 | 9.9% | 12.7% |
| A-102__half-archB | EXT-1 | 395.3 | 373.7 | 400.7 | 1.4% | 7.2% |
| A-102__half-archB | EXT-2 | 208.7 | 186.1 | 208.1 | -0.3% | 11.8% |
| A-102__half-archB | A1 | 846.0 | 782.0 | 847.0 | 0.1% | 8.3% |
| A-102__half-archB | A2 | 107.7 | 104.9 | 107.0 | -0.7% | 2.0% |
| A-102__half-archB | B1 | 44.0 | 42.8 | 44.0 | -0.1% | 2.7% |
| A-102__half-archB | C1 | 26.7 | 25.6 | 25.5 | -4.5% | -0.6% |
| A-102__half-archB | D1 | 30.0 | 29.6 | 30.0 | 0.1% | 1.4% |

## Materials

A-101, clean. Four ways to the same quantities. **(1)** the app's assembly rules written out by hand, independently of the app; **(2)** the app's own `scheduleLines` on the answer-key runs — (1) and (2) agreeing is the check on the recipe math; **(3)** an estimator's hand count (every opening deducted from board, door widths out of the bottom track, two jamb studs each side of an opening) — the gap between (1) and (3) is shop convention, not a bug; **(4)** the Find-the-walls path: every found group accepted, each given the type most of its footage really is and that type's commonest height, posted as `postMeasuredWallRun` does (one run per group, no openings typed). Percentages are against (1).

| Path | Type | LF | Studs | Track LF | Board SF | Insulation SF |
| --- | --- | --- | --- | --- | --- | --- |
| (1) app rules, by hand | EXT-1 | 395 | 300 | 791 | 11065 | 5532 |
| (1) app rules, by hand | EXT-2 | 209 | 158 | 417 | 6051 | 3026 |
| (1) app rules, by hand | A1 | 1100 | 856 | 2200 | 22741 | 0 |
| (1) app rules, by hand | A2 | 203 | 169 | 406 | 5887 | 2944 |
| (1) app rules, by hand | B1 | 149 | 117 | 297 | 4311 | 0 |
| (1) app rules, by hand | F1 | 49 | 40 | 99 | 717 | 0 |
| (1) app rules, by hand | C1 | 27 | 16 | 53 | 1160 | 0 |
| (1) app rules, by hand | D1 | 33 | 52 | 132 | 957 | 0 |
| (2) app scheduleLines | EXT-1 | 395 (0.0%) | 300 (0.0%) | 791 (0.0%) | 11065 (0.0%) | 5532 (-0.0%) |
| (2) app scheduleLines | EXT-2 | 209 (0.0%) | 158 (0.0%) | 417 (-0.0%) | 6051 (-0.0%) | 3026 (0.0%) |
| (2) app scheduleLines | A1 | 1100 (0.0%) | 856 (0.0%) | 2200 (-0.0%) | 22741 (0.0%) | 0 (—) |
| (2) app scheduleLines | A2 | 203 (0.0%) | 169 (0.0%) | 406 (0.0%) | 5887 (0.0%) | 2944 (0.0%) |
| (2) app scheduleLines | B1 | 149 (0.0%) | 117 (0.0%) | 297 (-0.0%) | 4311 (-0.0%) | 0 (—) |
| (2) app scheduleLines | F1 | 49 (0.0%) | 40 (0.0%) | 99 (-0.0%) | 717 (-0.0%) | 0 (—) |
| (2) app scheduleLines | C1 | 27 (0.0%) | 16 (0.0%) | 53 (-0.0%) | 1160 (-0.0%) | 0 (—) |
| (2) app scheduleLines | D1 | 33 (0.0%) | 52 (0.0%) | 132 (0.0%) | 957 (0.0%) | 0 (—) |
| (3) estimator by hand | EXT-1 | 395 (0.0%) | 340 (13.3%) | 768 (-2.9%) | 10703 (-3.3%) | 5351 (-3.3%) |
| (3) estimator by hand | EXT-2 | 209 (0.0%) | 186 (17.7%) | 414 (-0.7%) | 5709 (-5.7%) | 2855 (-5.7%) |
| (3) estimator by hand | A1 | 1100 (0.0%) | 972 (13.6%) | 2105 (-4.3%) | 21638 (-4.9%) | 0 (—) |
| (3) estimator by hand | A2 | 203 (0.0%) | 177 (4.7%) | 400 (-1.5%) | 5803 (-1.4%) | 2902 (-1.4%) |
| (3) estimator by hand | B1 | 149 (0.0%) | 125 (6.8%) | 291 (-2.0%) | 4227 (-1.9%) | 0 (—) |
| (3) estimator by hand | F1 | 49 (0.0%) | 40 (0.0%) | 99 (0.0%) | 717 (0.0%) | 0 (—) |
| (3) estimator by hand | C1 | 27 (0.0%) | 16 (0.0%) | 53 (0.0%) | 1160 (0.0%) | 0 (—) |
| (3) estimator by hand | D1 | 33 (0.0%) | 52 (0.0%) | 132 (0.0%) | 957 (0.0%) | 0 (—) |
| (4) Find the walls → post | EXT-1 | 368 (-7.0%) | 277 (-7.7%) | 736 (-7.0%) | 10668 (-3.6%) | 5334 (-3.6%) |
| (4) Find the walls → post | EXT-2 | 253 (21.4%) | 193 (22.2%) | 507 (21.4%) | 7346 (21.4%) | 3673 (21.4%) |
| (4) Find the walls → post | A1 | 1300 (18.2%) | 976 (14.0%) | 2599 (18.2%) | 27293 (20.0%) | 0 (—) |
| (4) Find the walls → post | A2 | 0 (-100.0%) | 0 (-100.0%) | 0 (-100.0%) | 0 (-100.0%) | 0 (-100.0%) |
| (4) Find the walls → post | B1 | 152 (2.5%) | 118 (0.9%) | 305 (2.5%) | 4418 (2.5%) | 0 (—) |
| (4) Find the walls → post | F1 | 79 (59.0%) | 60 (50.0%) | 157 (59.0%) | 1140 (59.0%) | 0 (—) |
| (4) Find the walls → post | C1 | 0 (-100.0%) | 0 (-100.0%) | 0 (-100.0%) | 0 (-100.0%) | 0 (—) |
| (4) Find the walls → post | D1 | 43 (31.3%) | 68 (30.8%) | 173 (31.3%) | 1256 (31.3%) | 0 (—) |

- cluster 1 posted as A1 @ 10.5' also holds 252.7 ft of A2, 25.4 ft of C1
- cluster 3 posted as EXT-2 @ 14.5' also holds 18.0 ft of non-walls
- cluster 5 posted as F1 @ 14.5' also holds 30.0 ft of non-walls
- cluster 8 posted as B1 @ 14.5' also holds 5.3 ft of EXT-1

- A-101__revit: Find-the-walls path board 51610 SF vs 52889 (-2.4%); studs 1669 vs 1708 (-2.3%)
- A-101__autocad: Find-the-walls path board 52777 SF vs 52889 (-0.2%); studs 1721 vs 1708 (0.8%)
- A-101__skia: Find-the-walls path board 52426 SF vs 52889 (-0.9%); studs 1703 vs 1708 (-0.3%)
- A-102__revit: Find-the-walls path board 35953 SF vs 37457 (-4.0%); studs 1308 vs 1303 (0.4%)
- A-102__autocad: Find-the-walls path board 35945 SF vs 37457 (-4.0%); studs 1309 vs 1303 (0.5%)
- A-102__skia: Find-the-walls path board 36952 SF vs 37457 (-1.3%); studs 1286 vs 1303 (-1.3%)

## Schedules (deterministic half: `tableRowsFromPage`)

- **A-601__clean**: looksLikeTable=true; 50 schedule rows expected, 16 reach the model as an exact row, 30 merged with a row of the OTHER schedule, 33 have blank cells dropped (columns no longer line up), 0 missing, 12 orphan rows from wrapped cells. Examples: `100A: [100A | 3'-0" | 7'-0" | A | WD | HM | 20 MIN | 1 | SF1 | SF | 20'-0" | 10'-0" | 0'-0" | 1" IGU LOW-E]`; `150A: [150A | MESA RIDGE MEDICAL]`; `110: [110 | OFFICE BUILDING]`; `111: [111 | 3'-0" | 7'-0" | A | WD | HM | 4 | W1-3 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`; `112: [112 | 3'-0" | 7'-0" | A | WD | HM | 5 | W1-4 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`; `113: [113 | 3'-0" | 7'-0" | A | WD | HM | 6 | W1-E1 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`
- **A-601__revit**: looksLikeTable=true; 50 schedule rows expected, 16 reach the model as an exact row, 30 merged with a row of the OTHER schedule, 33 have blank cells dropped (columns no longer line up), 0 missing, 12 orphan rows from wrapped cells. Examples: `100A: [100A | 3'-0" | 7'-0" | A | WD | HM | 20 MIN | 1 | SF1 | SF | 20'-0" | 10'-0" | 0'-0" | 1" IGU LOW-E]`; `150A: [150A | MESA RIDGE MEDICAL]`; `110: [110 | OFFICE BUILDING]`; `111: [111 | 3'-0" | 7'-0" | A | WD | HM | 4 | W1-3 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`; `112: [112 | 3'-0" | 7'-0" | A | WD | HM | 5 | W1-4 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`; `113: [113 | 3'-0" | 7'-0" | A | WD | HM | 6 | W1-E1 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`
- **A-601__autocad**: looksLikeTable=true; 50 schedule rows expected, 16 reach the model as an exact row, 30 merged with a row of the OTHER schedule, 33 have blank cells dropped (columns no longer line up), 0 missing, 12 orphan rows from wrapped cells. Examples: `100A: [100A | 3'-0" | 7'-0" | A | WD | HM | 20 MIN | 1 | SF1 | SF | 20'-0" | 10'-0" | 0'-0" | 1" IGU LOW-E]`; `150A: [150A | MESA RIDGE MEDICAL]`; `110: [110 | OFFICE BUILDING]`; `111: [111 | 3'-0" | 7'-0" | A | WD | HM | 4 | W1-3 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`; `112: [112 | 3'-0" | 7'-0" | A | WD | HM | 5 | W1-4 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`; `113: [113 | 3'-0" | 7'-0" | A | WD | HM | 6 | W1-E1 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`
- **A-601__skia**: looksLikeTable=true; 50 schedule rows expected, 16 reach the model as an exact row, 30 merged with a row of the OTHER schedule, 33 have blank cells dropped (columns no longer line up), 0 missing, 12 orphan rows from wrapped cells. Examples: `100A: [100A | 3'-0" | 7'-0" | A | WD | HM | 20 MIN | 1 | SF1 | SF | 20'-0" | 10'-0" | 0'-0" | 1" IGU LOW-E]`; `150A: [150A | MESA RIDGE MEDICAL]`; `110: [110 | OFFICE BUILDING]`; `111: [111 | 3'-0" | 7'-0" | A | WD | HM | 4 | W1-3 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`; `112: [112 | 3'-0" | 7'-0" | A | WD | HM | 5 | W1-4 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`; `113: [113 | 3'-0" | 7'-0" | A | WD | HM | 6 | W1-E1 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`
- **A-601__layers**: looksLikeTable=true; 50 schedule rows expected, 16 reach the model as an exact row, 30 merged with a row of the OTHER schedule, 33 have blank cells dropped (columns no longer line up), 0 missing, 12 orphan rows from wrapped cells. Examples: `100A: [100A | 3'-0" | 7'-0" | A | WD | HM | 20 MIN | 1 | SF1 | SF | 20'-0" | 10'-0" | 0'-0" | 1" IGU LOW-E]`; `150A: [150A | MESA RIDGE MEDICAL]`; `110: [110 | OFFICE BUILDING]`; `111: [111 | 3'-0" | 7'-0" | A | WD | HM | 4 | W1-3 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`; `112: [112 | 3'-0" | 7'-0" | A | WD | HM | 5 | W1-4 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`; `113: [113 | 3'-0" | 7'-0" | A | WD | HM | 6 | W1-E1 | W1 | 4'-0" | 5'-0" | 3'-0" | 1" IGU LOW-E]`

## Addendum 2 and takeoff currency

- Answer key: 1 removed (N-EX50), 0 added, 24 changed (C-S, C-N, B-S, B-N, N-EX40, N-EX60, N-EX70, N-EX80, N-D, NS-45, NS-V, N-E, N-F, IM-V, S-EX40, S-EX50, S-EX60, S-EX70, S-EX80, S-D, S-E, S-F, S-165, RR-CH).
- A1: key 1099.9 → 1050.0 ft (Δ -49.8); detected 1021.6 → 956.1 ft (Δ -65.5)
- A2: key 203.0 → 190.0 ft (Δ -13.0); detected 252.7 → 232.1 ft (Δ -20.6)
- B1: key 148.7 → 188.3 ft (Δ 39.7); detected 147.1 → 186.4 ft (Δ 39.4)
- D1: key 33.0 → 37.0 ft (Δ 4.0); detected 43.3 → 47.3 ft (Δ 3.9)
- sheet date entered (2026-08-04): SUPERSEDED — "45 measurements came off Rev 1, issued 2026-08-04. A-101 REV 1 Addendum 2 (2026-09-14) has been issued since. Go and check what moved — nothing here re-measures anything."
- no sheet date entered (the common case): UNKNOWABLE — "No issue date recorded for Rev 1, so nothing here can tell whether 45 measurements came off current drawings. Put the date from the title block on it."

## How each stage decides, and which case targets which threshold

### How the pipeline decides what a wall is

Read from `main` at #681. The wall finder runs in the browser (`TakeoffPlanViewer.onFindWalls`), only once the sheet has a scale: `wallsFromBothEngines` (the pair-finder below AND `wallRunsFromStrokes`, a room-tracing engine, merged by `mergeWalls` so overlap is not billed twice) → `wallsInTheBuilding` → `wallsNotLettering` → `wallsNotTheSheetBorder` → `clusterByThickness`.

| Stage | File | Rule | Threshold | Cases aimed at it |
| --- | --- | --- | --- | --- |
| Read strokes | `sheetStrokes.ts` | Every `constructPath` becomes segments: `moveTo`/`lineTo`, the four sides of a `re`, and `closePath`. `curveTo` is **flattened** to a polyline at `CURVE_FLATNESS_POINTS` and marked `curved`. The paint operator is never looked at, so fills, clip paths and `n` paths all count. The CTM stack handles `q`/`Q`/`cm` **and `paintFormXObjectBegin`**, which is the only place pdfjs reports a Form XObject's `/Matrix`. The pen position **carries across `constructPath` boundaries**, because pdfjs can split one path into several operators. Optional content is read: strokes carry their layer name and a layer the file marks OFF is skipped. The dash pattern is still ignored. | — | autocad (forms + xref), revit (fill-only polygons), ocg, layers, clip, dashed, rotate (CropBox), skia, scan, every curved wall |
| Layer names | `layerNames.ts` | A stroke whose layer is confidently not a wall is dropped before any geometry is measured: NCS majors like `ANNO`, `GRID`, `DUCT`, `FURN`, `TTLB`, plus `EXST`/`DEMO` as out-of-scope. `wall` and **`unknown` are kept**, a sheet with no layers is untouched, and the filter refuses to empty a sheet. | — | layers; P16, P17, P18 |
| Input floor | `wallsFromStrokes` | Segments shorter than `minLengthFeet` are dropped before pairing. The series test only ever sees segments that survived this. | 2 ft | revit (faces cut into 1.5–6 ft pieces), shx (stroked lettering) |
| Pair: parallel | `wallFromPair` | `PARALLEL_TOLERANCE_RAD` | 2° | 17.5°/30°/45° walls, holdout angles |
| Pair: thickness | `wallFromPair` | Perpendicular distance from b's midpoint to a's line, in feet | 0.2–1.5 ft (2.4"–18") | F1 furring 1-1/2" (under), D1 chase 14-1/2" (inside), 18" duct (exactly on the ceiling), 12–16" ducts, 1x4 lights (12"), girder flanges (9"), streets on the vicinity map |
| Pair: overlap | `wallFromPair` | Overlap ≥ 50% of the SHORTER face | 0.5 | dimension strings, revit's staggered pieces |
| Pair: length | `wallFromPair` | Overlap ≥ `minLengthFeet` | 2 ft | short returns, door-adjacent pieces |
| Pair: face ratio | `wallFromPair` | Longer face ≤ 3× the shorter (`MAX_FACE_LENGTH_RATIO`) | 3× | every T junction (one face broken, the other continuous), walls with doors |
| Series (hatch) rejection | `inAHatchSeries` | A pair is dropped if ANY third parallel segment (≥ 2 ft, overlapping face a by half the shorter) lies beyond either face within 2.5× the face spacing | `SERIES_REACH` 2.5 | EXT-1 (5 lines), EXT-2 (4 lines), D1 (4 lines), gridlines 8" off an exterior wall, casework 1'-0" off a face, grab bars, handrails, stair treads, schedule rules |
| Merge | `mergeWalls` | The two engines' runs are unioned by extent; overlapping evidence for one wall becomes one run | — | revit (duplicate strokes — now handled, probe P4) |
| Face reuse | `wallsFromStrokes` | Segments sorted longest-first; each face used once; first passing partner wins | — | duplicate strokes (revit), T junctions, casework/handrail lines that steal a face |
| Centreline | `wallFromPair` | Centreline only over the OVERLAP of the two faces | — | every L corner and T (the answer key reports centreline AND face-overlap) |
| In the building | `wallsInTheBuilding` | Union-find, point-to-segment distance; keep the biggest group by footage; nothing if it has < 10 runs | `SAME_BUILDING_FEET` 20 ft, `NOT_A_BOX` 10 | A-401 (three views on one sheet), scale bar 17 ft below the plan, ducts, soffits, the vicinity map |
| Not lettering | `wallsNotLettering` | Drop runs ≤ 4 ft whose midpoint is inside a text box (+0.5 ft) | `LETTER_FEET` 4 | shx (no text boxes at all), room tags |
| Group | `clusterByThickness` | Sort by thickness; a run joins the open group if within 0.5" of the group's FIRST run | `CLUSTER_INCHES` 0.5 | A1 4-7/8" vs C1 4-3/4" (1/8" apart), A1 vs A2 (identical) |
| Post | `postMeasuredWallRun` → `recipeInputsFromMeasurements` | An accepted group's runs are SUMMED into one `WallRun` with one height and the openings typed on the form (none, on this path) | — | materials section |

### How it picks a scale

`PAGE_INVENTORY` (`pageInventory.ts`) → `readSheetScale` → `scaleFromDimensions`, falling back to `scaleFromPrinted`. One answer per PAGE.

| Rule | Threshold | Cases aimed at it |
| --- | --- | --- |
| A label must match `^\d{1,3}'\s*-?\s*(\d{1,2}( \d/\d)?\s*"?)?$` and parse with `parseFeetInches`; ≤ 400 ft; not in the title-block corner (x ≥ 60% AND y ≥ 75%) | — | overridden-dims (`EQ`, `VERIFY`, `+/-`), shx (no text at all) |
| A label pairs with a segment ≥ 8pt when it is ≤ 30pt off the line and within 30% of its midpoint | 30pt, 0.3 | vertical (rotated) dimension text, autocad (geometry in the wrong place) |
| Each pair votes for the architectural scale within 2% | `SCALE_TOLERANCE` 0.02 | half-11x17 (0.472× print lands 6% off 1/16") |
| Votes are DISTINCT LABEL TEXT, not pairs | — | eight identical `30'-0"` bays count as one vote (probe P13) |
| ≥ 3 distinct labels must agree, and the winner needs 2× the runner-up | `minAgreeing` 3, `minMargin` 2 | A-401 (1/4" restroom view with ~3× the 1/2" stair view's dimensions) |
| Engineering-scale readings decline | — | — |
| The proposed line must be ≥ 5% of the page width (`MIN_CALIBRATION_SPAN`) and ≤ 0.5% off the named scale | 0.05, 0.005 | A-401, small sheets |
| Printed fallback only when the dimensions declined: exactly one standard scale printed anywhere on the page (items ≤ 60 chars), page a standard sheet size within 2% | 0.02 | half-archB (half of ARCH D IS ARCH B), half-11x17 (ANSI B is standard), A-401 (`AS NOTED` + two captions) |
| No text layer (< 3 items) ⇒ "This sheet is a scan" | `MIN_TITLE_BLOCK_ITEMS` 3 | scan, shx (outlined text is not a scan) |
| ≥ 2,000 segments and < 3 labels ⇒ "lettering saved as line work" | `PLAINLY_A_DRAWING` 2000 | shx |

### Schedules

`tableRowsFromPage`: rows by baseline within 0.6× the text height of the row's FIRST item; a new cell when the gap exceeds 1.5 character widths; empty strings dropped. Aimed at by A-601: a door schedule and a window schedule side by side on the same baselines, blank cells, and remarks wrapped onto two lines.

### Takeoff currency

`planCurrency` compares the sheet's ENTERED issue date with revisions and addenda logged on the job. It never looks at the drawing. Aimed at by A-101-REV1 (Addendum 2).

