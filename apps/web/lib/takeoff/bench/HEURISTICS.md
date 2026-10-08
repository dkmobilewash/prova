### How the pipeline decides what a wall is

Read from `main` at #681. The wall finder runs in the browser (`TakeoffPlanViewer.onFindWalls`), only once the sheet has a scale: `wallsFromBothEngines` (the pair-finder below AND `wallRunsFromStrokes`, a room-tracing engine, merged by `mergeWalls` so overlap is not billed twice) → `wallsInTheBuilding` → `wallsNotLettering` → `wallsNotTheSheetBorder` → `clusterByThickness`.

| Stage | File | Rule | Threshold | Cases aimed at it |
| --- | --- | --- | --- | --- |
| Read strokes | `sheetStrokes.ts` | Every `constructPath` becomes segments: `moveTo`/`lineTo`, the four sides of a `re`, and `closePath`. **`curveTo` is skipped.** The paint operator is never looked at, so fills, clip paths and `n` paths all count. The CTM stack handles `q`/`Q`/`cm`; it does **not** handle `paintFormXObjectBegin`, which is the only place pdfjs reports a Form XObject's `/Matrix`. Optional content and the dash pattern are both ignored. | — | autocad (forms + xref), revit (fill-only polygons), ocg, clip, dashed, rotate (CropBox), skia, scan, every curved wall |
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
