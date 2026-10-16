# Takeoff audit — 2026-10-15

Read-only. Nothing was changed, fixed or committed to produce this. Every
status below cites the command that produced it; where something could not be
run, it says **Unverified** rather than guessing.

Audited at `main` = `8b82f6e5`.

**CORRECTED after the overlays were generated and read.** The first version of
this file rated two wall capabilities from code and stage counts, and gave one
cause for five failing sheets. Opening the pictures changed one rating
(C13 Unverified → Missing), sharpened two (C12, C20) and split the zero-wall
explanation into three separate failures. **The overall score is unchanged at
50.3%** — what changed is what the work actually is. The corrections are
marked in place rather than quietly applied; the mistake is the kind this file
criticises elsewhere, made by its own author, and hiding it would make the
document less useful.

---

## Step 1 — Inventory

### The path a plan takes

```
  upload  →  PlanIngest stages (background)            →  takeoff tab (UI)
             ├ PAGE_INVENTORY  pageInventory.ts            TakeoffPlanViewer.tsx
             │   ├ planPdf.ts        text layer?           ├ "Find the walls"
             │   ├ titleBlock.ts     sheet number/title    ├ "Check these are walls" (AI)
             │   ├ dimensionLabels   imperial + metric     ├ "Read this sheet"      (AI)
             │   ├ scaleFromDimensions.ts  THE SCALE       ├ Move / Set scale
             │   └ scaleFromPrinted.ts     fallback        └ Line / Area / Count (manual)
             └ … other stages                                        │
                                                                     ▼
   sheetStrokes.ts ──► findWallsOnSheet.ts ──► wallGroups ──► postTakeoffMeasurements()
   (vector geometry)    wallsFromBothEngines                          │
                        wallsInTheBuilding                            ▼
                        wallsNotLettering                     estimating line items
                        wallsNotTheSheetBorder
```

- **Engine**: `apps/web/lib/takeoff/` — 35 non-test modules.
- **Entry from UI**: `components/TakeoffPlanViewer.tsx`, `app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx`.
- **Server actions**: `lib/actions/takeoff.ts` (measurements, calibration, posting),
  `takeoffClassify.ts` (AI wall labels), `takeoffReadSheet.ts` (AI scan OCR).
- **Ingest**: `lib/plan-ingest/` — staged background work.
- **Evidence**: `ls apps/web/lib/takeoff/*.ts`; grep for module imports from
  `app components lib/actions lib/plan-ingest`.

### AI calls in the takeoff path

| call | file | what it does | produces geometry? |
| --- | --- | --- | --- |
| `labelWallCandidates` | `wallClassify.ts` | labels found runs WALL / CASEWORK / REFERENCE | **no** — a label per run id |
| `readSheetTextTile` | `sheetText.ts` | reads lettering off a SCANNED tile | **coordinates — see flag** |
| `countSymbols` | `symbols.ts` | counts fixtures in a crop | no — a count |
| `classifyPlanSheets` | `planSheets.ts` | sheet kind from title-block TEXT | no |
| `readScheduleRows` | `scheduleRows.ts` | schedule tables from text | no |

**FLAG, and it is a real one.** `readSheetTextTile` returns `{text, x, y,
width, height}` — the model IS producing coordinates. The defence, and the
reader should judge it rather than take it: they are the positions of
LETTERING, not of walls; no length, area or quantity is derived from them; a
dimension's *value* comes from the model and the *line* it is paired with is
measured by code, so the scale is a quotient of one model-read number and one
code-measured one. Every other AI call is strictly label-or-count.

### Fixtures, scorer, overlay

| thing | exists | runs |
| --- | --- | --- |
| `fixtures/plans/S01–S20.pdf` | yes, committed | — |
| `fixtures/expected/S01–S20.json` | yes, committed | — |
| `fixtures/score.eval.ts` (scorer) | yes | **yes** — 3.2s |
| `fixtures/overlay.eval.ts` | yes | **yes** — 5.1s, 20 PNGs; see Step 2.2 |
| `fixtures/stages.eval.ts` | yes | yes (earlier in session) |
| `reports/takeoff-bench` (2nd set, wall LF truth) | yes | **yes** — `pnpm takeoff:bench` |

### Does the engine read the answer keys?

**No.** `bash` over the 35 engine modules:

- references to `fixtures/expected` / `answerKey` / `expected.json` — **none**
- fixture ids `S01`–`S20` hard-coded — **none**
- imports from `./fixtures` or `./bench` — **none**
- fixture/bench PATHS — **2 hits, both COMMENTS** (`sheetStrokes.ts:386`,
  `wallVectors.ts:647`) naming the bench in prose
- special-cased page sizes — 1 hit, a COMMENT about float precision
  (`reducedPrint.ts:117`)

Clean.

---

## Step 2 — The scorer

### `score.eval.ts`, all 20 fixtures

```
id   scale     how         printed         rooms   strokes  runs  groups   wall ft
S01  ✓         dimensions  1/4" = 1'-0"       —/1       86     0       0        0
S02  ✓         dimensions  1/4" = 1'-0"       —/6      183    10       2      223
S03  ✓         dimensions  1/8" = 1'-0"       —/6      176    10       2      223
S04  ✓         dimensions  1/4" = 1'-0"      —/10      382    19       5      364
S05  ✓         dimensions  3/16" = 1'-0"      —/9      309    20       5      275
S06  ✓         dimensions  1/4" = 1'-0"       —/4      190     0       0        0
S07  ✓         dimensions  1/4" = 1'-0"       —/5      427    11       4      162
S08  ✓         dimensions  1/4" = 1'-0"      —/13      733    28       8      406
S09  ✓         dimensions  1/4" = 1'-0"       —/9      341    14       4      300
S10  —         dimensions  none               —/5      161     0       0        0
S11  conflict  dimensions  1/8" = 1'-0"       —/5      153     0       0        0
S12  —         dimensions  none              —/10      375    16       5      387
S13  ✓         dimensions  1/8" = 1'-0"      —/12      641    20       4      555
S14  ✓         dimensions  1/8" = 1'-0"       —/9      541    24       4      608
S15  ✓         dimensions  1/4" = 1'-0"       —/5      302     0       0        0
S16  ✓         dimensions  1:100              —/7      182    10       3      223
S17  ✓         dimensions  1:50               —/6      250    10       4      181
S18  declined  raster      none                          0     —       —        —
S19  declined  raster      none                          0     —       —        —
S20  declined  raster      none                          0     —       —        —
```

**SCALE: 14 of 14 scored correct. 3 correctly declined. 1 conflict (correct —
the sheet contradicts its own title block and the dimensions were followed).**

**AND HERE IS THE PROBLEM WITH THIS TABLE.** The scorer's own last two lines:

```
WALL FOOTAGE: reported, NOT SCORED — no sheet in this set prints one.
ROOMS: key has 122 tagged rooms; the pipeline does not yet report a room list here.
```

So the headline number this fixture set produces is **a scale score and
nothing else**. There is no wall LF error, no room count, no room area, no
room type, no door/window count and no gross area in it — not because they
score badly, but because **the set cannot ask**. The answer keys were
deliberately limited to what a drawing PRINTS, and these drawings print a
scale and room tags, not wall footage.

Anyone reading "14 of 14" as a takeoff accuracy figure is reading a scale
figure.

**5 of 15 vector sheets return ZERO walls** (S01, S06, S10, S11, S15).

**THE FIRST VERSION OF THIS AUDIT GAVE ONE CAUSE FOR ALL FIVE AND THAT WAS
WRONG.** It said `NOT_A_BOX = 10` discards buildings of fewer than ten runs,
full stop — written from stage counts without opening the pictures. The
overlays say there are at least three different failures here, and the fix for
one does not touch the others:

| sheet | what the drawing is | why it returns nothing |
| --- | --- | --- |
| S01 | STUDIO OFFICE — **one room, four walls** | far under `NOT_A_BOX`; nothing could save it but a lower floor |
| S10 | GARDEN COTTAGE — ordinary thin double-line walls, axis-aligned, 5 rooms | under `NOT_A_BOX` |
| S11 | GUEST HOUSE — same shape, 5 rooms | under `NOT_A_BOX` |
| S15 | BUNGALOW **plus an ENLARGED BATH PLAN at a second scale on the same sheet** | thin walls; and capability A5 (multi-view sheets) is Missing |
| S06 | **HOUSE WITH ANGLED WING — walls drawn as SOLID FILLED POCHÉ, one wing at 45°** | **not the threshold at all** — poché and angled geometry |

So S10 and S11 are the honest `NOT_A_BOX` cases, S01 is under any plausible
floor, **S15 points at multi-view sheets**, and **S06 is a different bug
entirely**. The work plan's step 2 (an enclosure test instead of `NOT_A_BOX`)
would fix S10 and S11 and **would not fix S06**.

### `reports/takeoff-bench` — the only set with wall footage truth

`TAKEOFF_BENCH=1 pnpm takeoff:bench`. **All four quality bars FAIL:**

| bar | result |
| --- | --- |
| Scale 100% correct or honestly undetermined | ❌ 63/70 correct or declined; **7 wrong-but-confident** (half-size sheets: `A-101__half-11x17`, `A-101__half-archB-outlines`, `A-401__clean`, …) |
| In-scope wall LF within 2% per type | ❌ **28 of 60 type-totals outside ±2%**; worst `A-101__clean/D1` **31.3%** |
| Zero-wall sheets: 0 phantom LF | ❌ **11 of 36** produced walls — `A-111__clean` **2,314 ft**, `__autocad` 2,406 ft |
| No wall over 10 ft missed entirely | ❌ **27 cases** miss at least one; **115 walls** in total |

Probes: **11 pass, 7 fail** (P6 furring under the thickness floor, P9 clip
path, P10 dashed demo walls, P11/P12 half-size scale guard, P14 thickness
clustering, P15 one-run-per-group stud count).

Holdout set: **31,913 of 32,655 ft, −2.3% overall, 0 wrong-but-confident
scales.** That total is close, and it is close *because errors cancel* — the
per-type table above is the honest read.

### The overlays — what is visibly wrong

`overlay.eval.ts` → 20 PNGs in `fixtures/overlays/` (not committed). Read, not
skimmed. **These corrected two ratings and one explanation below.**

- **S06** — walls are **solid filled poché**, one wing at **45°**. Nothing
  found. This is the sheet that disproves "all five are the threshold".
- **S10, S11** — textbook small plans, thin parallel-line walls, perfectly
  axis-aligned, nothing found. **More damning than S06**: these are the easy
  case and the pipeline returns zero on them.
- **S01** — a single room, four walls. Zero is arithmetic, not a bug.
- **S15** — two views at different scales on one sheet (FLOOR PLAN 1/4",
  ENLARGED BATH PLAN at another). Nothing found.
- **S13** (20 runs, 555 ft) — **largely correct**: exterior, corridor and
  every office partition traced. Two over-detections: red stubs continuing
  **past the building at gridlines A and C**, and marks around the washroom
  **fixtures**.
- **S08** (28 runs, 406 ft) — exterior and all four bedroom partitions
  correct, and **the living-room sofa is traced as a wall**, plus marks at the
  kitchen counter and bath fixtures. This is capability 20 failing in the
  picture rather than in a number.

### Robustness

Present, as bench variants, and included in the failing bars above:
`rotate`, `half-11x17`, `half-archB`, `half-archB-outlines`, `clip`, `dashed`,
`ocg`, `layers`, `shx`, `plot-black`, `overridden-dims`, `scan`,
`autocad-flat`, `revit`, `skia`. **Shuffled drawing order: not present.**

### Unit tests

`npx vitest run` in `apps/web`: **763 files, 11,969 tests, all passing.**

---

## Step 3 — A real plan

**Cannot be run today. `/Users/diego/Downloads` is empty** (`ls` → 0 files);
the real sets used earlier in this session are gone. `realPlan.eval.ts` needs
`REAL_PLAN_PDF` and has nothing to point at. Marked **Unverified**.

**What WAS measured against real sets earlier today**, recorded here because
it is the only real-plan evidence that exists and it is unflattering:

- **Room finder on West Herr**: reported 46 rooms / 4,555 sf for a building
  ~290 ft across, missing Showroom 101, Sales 103, Hospitality 105, New Car
  Delivery 140 and an entire wing, while outlining a parked car and the gaps
  between dimension strings. The BUTTON WAS REMOVED as a result and
  `takeoffRoomFinder.test.tsx` asserts it stays absent.
- **Layer coverage**: of 5 real sets, 2 name their layers (West Herr 47
  layers, Comfort Inn 177); 3 name none.
- **Scanned pages**: of 11 real sets, 5 carry image-only pages and 1 is
  scanned end to end.

---

## Step 4 — Capability scorecard

Status key: **Done** = works end to end, reachable, verified by a run ·
**Partial** · **Engine only** = code+tests, not reachable · **Stub** ·
**Missing** · **Unverified**.

### A. Plan intake

| # | capability | status | evidence | missing | effort |
| --- | --- | --- | --- | --- | --- |
| 1 | Upload multi-page sets | **Done** | `planIngest.ts`, staged background work; 52–175pp sets ingested today | — | — |
| 2 | Vector vs scanned detection | **Done** | `hasTextLayer` in `sheetIndexQuery`; drives the "Read this sheet" button | — | — |
| 3 | Classify sheets | **Partial** | `planSheets.ts` (AI, from title text); `sheetSuitability.ts` wired | not graded; no eval | M |
| 4 | Sheet number/title from title block | **Done** | `titleBlock.ts`; School 01 shows 60/60 sheets, 5 unreadable (scans) | — | — |
| 5 | Split multi-view sheets, per-view scale | **Done** | `sheetViews.ts` — finds each drawing by its CAPTION NAME, reads the scale on the line below, and cuts the page on its GUTTERS (empty paper no geometry crosses) on BOTH axes, so stacked and side-by-side separate by the same rule. Each view is measured at its own scale; a view captioned NTS owns its region and is never measured. Wired in `onFindWalls`, gated to >= 2 views. S15 → FLOOR PLAN 1/4" 167 ft + ENLARGED BATH 1/2" 28 ft; the bench's A-401 → RESTROOM 1/4", STAIR 1/2", HEAD OF WALL DETAIL excluded. `sheetViews.eval.ts` + `benchMultiView.eval.ts`; 8 mutations red | per-view ACCURACY is the wall finder's, not this: A-401 reads 679 ft where the key says 266, and the single-scale baseline reads 678 — the same error | M |

### B. Scale

| # | capability | status | evidence | missing | effort |
| --- | --- | --- | --- | --- | --- |
| 6 | Printed scale notes, imperial + metric | **Done** | `scaleFromPrinted.ts` wired via `pageInventory.ts`; metric `METRIC_SCALES`; S16 1:100, S17 1:50 | — | — |
| 7 | Graphic scale bars | **Engine only** | `scaleBar.ts`, `scaleFromBar.ts` exist, tested; **no caller** in app/actions/ingest | wiring | S |
| 8 | Scale from dimension strings | **Done** | `scaleFromDimensions.ts`; 14/14 scored on fixtures | — | — |
| 9 | Flag wrong/missing scale | **Partial** | `calibrationNotices`, S11 conflict reported correctly; a sheet printing TWO scales now says so (`multiScaleCaution`, 2026-10-15) | **7 wrong-but-confident on half-size sheets** (bench P11/P12) | M |
| 10 | Manual calibration | **Done** | "Set scale" in toolbar; `saveTakeoffCalibration` | — | — |

### C. Walls

| # | capability | status | evidence | missing | effort |
| --- | --- | --- | --- | --- | --- |
| 11 | Parallel line pairs | **Partial** | bench P1–P5 pass; **26/60 type totals outside 2%** (was 28/60) | accuracy | L |
| 12 | Filled/hatched walls | **Partial** | raster path emits faces (85–91% of the drawing's own footage). **The "vector poché is unread" line was NOT verified and is wrong about S06**: its solid bottom wall has BOTH faces stroked (53.47% and 54.52% of page width) and the reader returns them. What blocked it was the 12in thickness cap, measured. True filled-polygon poché remains untested — no fixture has one | a fixture with real filled poché | M |
| 13 | Angled walls | **Partial** | **RE-RATED 2026-10-15, and the Missing was my own error.** It read *"the S06 overlay shows a 45° wing returning nothing"* — true, and the wing returned nothing because `NOT_A_BOX` was discarding the WHOLE SHEET (item 11's lane), not because 45° fails. With that removed the wing returns 5 of 9 runs at 45°/135°, thicknesses 4.5–6.5in. A symptom of another defect, read as a capability gap | accuracy ungraded — no fixture prints a wall length | M |
| 14 | Curved walls | **Missing** | `flattenCubic` flattens Béziers; no curved-wall probe or handling | everything | L |
| 15 | Corners / T-junctions | **Partial** | bench P5 passes (one-face-one-use) | **P15 fails** — a group collapses to ONE run, so stud counts are wrong | M |
| 16 | Exterior vs interior | **Missing** | no module, no field | everything | M |
| 17 | Type/thickness grouping | **Partial** | `clusterByThickness`, `wallTypeMatch` wired | **P14 fails** — 4-7/8" and 4-3/4" merge into one group | S |
| 18 | LF gross and net of openings | **Partial** | gross only; `openings.ts` is **engine only** | net | M |
| 19 | Wall area (LF × height) | **Missing** | no height source, no area field | everything | M |
| 20 | Ignore clutter | **Partial** | filters exist; the S08 sofa and the S13 grid stubs are GONE (`gridBubbles` wired in, 2026-10-15) and both overlays are clean; still Partial because no fixture scores footage, so completeness is unproven. Originally: S13 traces washroom fixtures and runs past the building at two gridlines | **11/36 zero-wall sheets produce up to 2,406 phantom ft** | L |

### D. Openings

| # | capability | status | evidence | missing | effort |
| --- | --- | --- | --- | --- | --- |
| 21 | Doors with widths | **Engine only** | `openings.ts` imported only by `roomAreas.ts`/`wallRuns.ts`; no UI, no action | wiring + grading | M |
| 22 | Windows with widths | **Engine only** | same | same | M |
| 23 | Link to schedules/tags | **Partial** | `scheduleRows.ts` (AI) reads schedule tables; **not joined to openings** | the join | M |

### E. Rooms

| # | capability | status | evidence | missing | effort |
| --- | --- | --- | --- | --- | --- |
| 24 | Detect enclosed rooms | **Engine only — deliberately disabled** | `roomAreas.ts` + tests kept; button REMOVED after the West Herr result; `takeoffRoomFinder.test.tsx` asserts absence | the filters the wall finder has and the room finder lacks | L |
| 25 | Room area / perimeter | **Engine only** | same module | same | L |
| 26 | Read room labels | **Partial** | `roomsFromWords` in the fixture key reads 122 tags; **the pipeline does not report a room list** | wiring | M |
| 27 | Classify room types | **Missing** | no module | everything | M |
| 28 | Check area vs printed tag | **Missing** | `AREA_PRINTED` parsed in the KEY only | everything | S |
| 29 | Gross building area | **Missing** | — | everything | M |
| 30 | Open-plan / stub walls | **Unverified** | no probe | grading | M |

### F. Scanned plans

| # | capability | status | evidence | missing | effort |
| --- | --- | --- | --- | --- | --- |
| 31 | Deskew / clean up | **Missing** | no deskew anywhere | everything | M |
| 32 | OCR text with positions | **Partial** | `rasterText.ts` + `takeoffReadSheet.ts` wired, gated, metered; **101/101 read, 98% placed on fixtures**; on the live app the last run returned 0 words from blank tiles — fix merged in #808, **unverified in production** | a green production run | S |
| 33 | Wall/room detection on scans | **Engine only** | `rasterStrokes.ts` grades 85–91% of the drawing's own footage; **no caller** — the viewer does not feed raster strokes to the wall finder | wiring | M |

### G. Beyond walls and rooms *(extras — excluded from the score)*

| # | capability | status | evidence | effort |
| --- | --- | --- | --- | --- |
| 34 | Symbol/fixture counting | **Engine only** | `symbols.ts` + `symbolCount.eval.ts`; `symbolCases.ts` engine only; no UI | M |
| 35 | Flooring/finish areas by room | **Missing** | depends on rooms | L |
| 36 | RCP ceiling areas | **Missing** | — | L |
| 37 | Revision comparison | **Partial** | `recordTakeoffPlanRevision` stores revisions; no diff/compare view | L |

### H. Review and editing UI

| # | capability | status | evidence | missing | effort |
| --- | --- | --- | --- | --- | --- |
| 38 | One-click "run takeoff" | **Missing** | there is "Find the walls" PER SHEET, after a scale is set per sheet. No set-level one-click | the whole flow | L |
| 39 | Viewer with overlay | **Done** | `TakeoffPlanViewer.tsx`, `FoundWalls` SVG overlay | — | — |
| 40 | Low-confidence highlighted | **Partial** | `duplicate-walls-caution`, `reduced-print-caution`, `no-walls`, `check-missing` | no per-item confidence | M |
| 41 | Edit walls / rooms | **Partial** | accept/reject per run and per group; **no move/add/delete of a wall**, no room editing | geometry editing | L |
| 42 | Live recalculation | **Done** | accept/reject updates totals before posting | — | — |
| 43 | Manual tools (linear/area/count) | **Done** | Line / Area / Count in the toolbar; `saveTakeoffMeasurement(s)` | — | — |
| 44 | Corrections saved and reusable as tests | **Partial** | accepted walls persist (`takeoff-found-walls.dbtest.ts`); **not harvested into fixtures** | the harvest | M |

### I. Output and integration

| # | capability | status | evidence | missing | effort |
| --- | --- | --- | --- | --- | --- |
| 45 | Quantities → estimating lines | **Done** | `postTakeoffMeasurements()` in `lib/actions/takeoff.ts` | — | — |
| 46 | Confidence + source per quantity | **Partial** | SOURCE is carried (measurement vs found wall); **no confidence band** — `wallVectors.ts:785` says so explicitly | confidence | M |
| 47 | Export CSV/Excel/PDF | **Unverified** | `app/api/takeoff/plan/[planId]/route.ts` exists; not exercised in this audit | — | S |
| 48 | Saved per project, reloadable | **Done** | `TakeoffMeasurement`, `PlanSheet*` models; reload verified by the tester reopening sheets | — | — |

### J. Production readiness

| # | capability | status | evidence | missing | effort |
| --- | --- | --- | --- | --- | --- |
| 49 | Background job + progress + errors | **Partial** | `plan-ingest/stages.ts` staged work; wall finding is FOREGROUND in the browser | background wall finding | M |
| 50 | Per-sheet runtime | **Partial** | vector: ~3.2s for 20 fixtures (scorer). Scanned: **44s per sheet, 15 model calls** (live run) | a target | — |
| 51 | AI calls cached/logged/validated | **Partial** | tool-use schemas + `readTextBoxes`/`readWallLabels` validate and DROP bad rows; usage metered (`recordAskUsage`); allowance claimed per call; **no caching**, no retry | cache + retry | M |
| 52 | Dependencies and licences | **Done** | `pdfjs-dist` Apache-2.0, `tesseract.js` + core Apache-2.0 (dev only), `@napi-rs/canvas` MIT. **No AGPL in the takeoff path** | — | — |
| 53 | Automated tests passing | **Done** | 11,969 tests green; 2 fixture sets; 15 evals | — | — |

---

## Step 5 — The bottom line

### 1. Overall completion — the arithmetic

Done = 100, Engine only = 60, Partial = 50, Stub/Missing/Unverified = 0.

| group | weight | items | sum | group % | contribution |
| --- | ---: | --- | ---: | ---: | ---: |
| **Scale** (6–10) | 15% | 100 + 60 + 100 + 50 + 100 | 410/5 | **82.0%** | 12.30 |
| **Walls** (11–20) | 25% | 50+50+**50**+0+50+0+50+50+0+50 | 350/10 | **35.0%** | 8.75 |
| **Openings** (21–23) | 10% | 60 + 60 + 50 | 170/3 | **56.7%** | 5.67 |
| **Rooms** (24–30) | 15% | 60+60+50+0+0+0+0 | 170/7 | **24.3%** | 3.64 |
| **Review UI** (38–44) | 15% | 0+100+50+50+100+100+50 | 450/7 | **64.3%** | 9.64 |
| **Integration** (45–48) | 10% | 100 + 50 + 0 + 100 | 250/4 | **62.5%** | 6.25 |
| **Intake** (1–5) | 5% | 100+100+50+100+**100** | 450/5 | **90.0%** | 4.50 |
| **Scanned** (31–33) | 5% | 0 + 50 + 60 | 110/3 | **36.7%** | 1.83 |

**TOTAL = 52.6%** (50.3% at the audit → 51.6% after Steps 1–3 → 52.1% after Step 4 → 52.6% with the view split, and UNCHANGED by the stacked-layout work, which deepened item 5 rather than moving a rating. Three ratings have moved in six steps: item 13 from 0 to 50, item 5 from 0 to 50 to 100. Everything else sat INSIDE items already scored Partial — a property of a 0/50/60/100 scale rather than a measure of the work. `reports/takeoff-bench/SCORECARD.md` is the finer instrument, and the fixture evals finer still.)

Extras (group G), reported separately: 60 + 0 + 0 + 50 = 110/4 = **27.5%**.

Production readiness (group J, unweighted): 50+50+50+100+100 = 350/5 = **70%**.

### 2. Accuracy summary

**On the 20 fixtures: scale passes 14 of 14 scored. Nothing else is scored at
all** — the set prints no wall footage and the pipeline reports no room list,
so wall LF, rooms, room types, doors, windows and gross area have **no score
on this set**.

**On the bench (the only wall-footage truth): all four bars fail.**

Worst failures, in order of how much they would cost a bid:

1. **11 of 36 zero-wall sheets invent walls** — up to **2,406 ft** on a sheet
   that should return nothing.
2. **27 cases miss a wall over 10 ft**; 115 walls missed in total.
3. **28 of 60 per-type LF totals outside ±2%**, worst 31.3% — and the
   aggregate of −2.3% hides this by cancellation.
4. **7 wrong-but-confident scales** on half-size prints. A wrong scale
   multiplies every quantity on the sheet.
5. **5 of 15 vector fixtures return zero walls** — and for THREE different
   reasons (threshold, poché+angles, multi-view), not one. Two of them (S10,
   S11) are ordinary axis-aligned double-line plans, which is the easy case.

**0 of 20 fixtures pass "all targets"** — because wall targets cannot be
evaluated on that set at all.

### 3. Top 5 blockers to a usable one-click takeoff

1. **There is no one-click.** Today: pick a sheet → set a scale → Find the
   walls → accept/reject → repeat per sheet. No set-level run exists (#38).
2. **Phantom walls on sheets with no walls**, up to 2,406 ft. Until a sheet
   that should be empty *is* empty, no unattended run can be trusted.
3. **Rooms are disabled**, on evidence from a real plan. Rooms gate room
   areas, room types, finishes and gross area — four more capabilities.
4. **Wall LF is not accurate enough per type** (28/60 outside 2%), and
   **nothing in the 20-sheet set can even measure it**.
5. **Openings are engine-only**, so every LF figure is gross. Net wall LF is
   what gets bid.

### 4. Remaining work plan

| # | step | effort | fixes |
| --- | --- | --- | --- |
| 1 | Give the 20-sheet set wall-footage truth (generate keys from the generator's own geometry, not from a reading) | M | makes S01–S20 able to grade walls at all |
| 2 | Kill phantom walls on zero-wall sheets — enclosure test instead of `NOT_A_BOX` | L | 11 bench cases **and S10/S11** (NOT S06 — see the overlays; and S01 has four walls) |
| 2b | **Vector poché and angled walls** — the S06 failure, which step 2 does not touch | L | S06; capabilities 12 and 13 |
| 3 | Fix the half-size scale guard (P11/P12) | S | 7 wrong-but-confident scales |
| 4 | Thickness clustering (P14) and per-run stud counts (P15) | M | 2 probes, per-type LF |
| 5 | Wire `openings.ts` → net wall LF | M | capability 18, 21, 22 |
| 6 | Wire raster strokes into the viewer so scans find walls | M | capability 33; scanned sets end to end |
| 7 | Room finder: give it the filters the wall finder has | L | capabilities 24–26, unblocks 27–30, 35 |
| 8 | Set-level "run takeoff" with per-sheet progress | L | capability 38, 49 |
| 9 | Confidence band per quantity | M | capability 46, 40 |
| 10 | Exterior/interior and wall area | M | capabilities 16, 19 |

### 5. Remaining effort

**Roughly 35–45 working days** to a one-click takeoff that could be trusted
unattended. Steps 1–6 alone (making the numbers right before adding surface
area) are **15–20 days**.

**Confidence: LOW-to-MEDIUM**, and the reason is specific: **the only real
plan evidence in this audit is a room finder that reported half a building.**
Every other number here comes from drawings this repo generated or from a
20-sheet set written by one generator. The bench's own header says a pass
there is a FLOOR. Real sets have already behaved differently twice today —
layer naming (2 of 5 sets) and scanned pages (5 of 11 sets).

### 6. Risks

- **Synthetic-to-real gap.** The worst result in this document came from the
  one real plan anybody ran. Expect more of that.
- **No real plan available to test against right now** — `~/Downloads` is
  empty. Until a real set is back, every number here is from generated
  drawings.
- **The aggregate hides the per-item error.** −2.3% total footage looks fine
  and contains 31% per-type errors in both directions. Any future "we're
  within 3%" claim should be checked per type.
- **Scanned sheets cost money per use** — ~15 Opus calls and 44 seconds per
  sheet. Tesseract was measured as a free replacement and reads 24% against
  the model's 100%; it is not viable without stripping line work first.
- **Curved and angled walls are unhandled and ungraded.** A set with either
  will under-report and nothing currently says so.
- **Performance for a 300-sheet set is unmeasured.** Wall finding runs in the
  browser, in the foreground, one sheet at a time.
