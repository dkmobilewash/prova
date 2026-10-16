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
| 5 | Split multi-view sheets, per-view scale | **Done** | `sheetViews.ts` — finds each drawing by its CAPTION NAME, reads the scale on the line below, and cuts the page on its GUTTERS (empty paper no geometry crosses) on BOTH axes, so stacked and side-by-side separate by the same rule. Each view is measured at its own scale; a view captioned NTS owns its region and is never measured. Wired in `onFindWalls`, gated to >= 2 views. S15 → FLOOR PLAN 1/4" 167 ft + ENLARGED BATH 1/2" 28 ft; the bench's A-401 → RESTROOM 1/4", STAIR 1/2", HEAD OF WALL DETAIL excluded. `sheetViews.eval.ts` + `benchMultiView.eval.ts`; 8 mutations red | per-view ACCURACY is the wall finder's, not this. Re-measured 2026-10-16: A-401 splits into RESTROOM 1/4" (16 runs, 647 ft) and STAIR 1/2" (10 runs, 386 ft) against a whole-sheet baseline of 20 runs at 716 ft. **And the BENCH does not use this path** — `harness.ts` calls `readSheetScale` per page, so the scorecard still reports A-401 as `SCALE WRONG_CONFIDENT` and scores the stair at 2.00× the truth. The app does split it (`TakeoffPlanViewer.tsx`); the bench understates what an estimator sees | M |

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
| 11 | Parallel line pairs | **Partial** | bench P1–P5 pass; **17/60 type totals outside 2%** (28 → 26 → 20 → 17); the twenty score 13 of 17 within ±2% of the generator's own geometry (was 1) | accuracy | L |
| 12 | Filled/hatched walls | **Partial** | raster path emits faces (85–91% of the drawing's own footage). **The "vector poché is unread" line was NOT verified and is wrong about S06**: its solid bottom wall has BOTH faces stroked (53.47% and 54.52% of page width) and the reader returns them. What blocked it was the 12in thickness cap, measured. True filled-polygon poché remains untested — no fixture has one | a fixture with real filled poché | M |
| 13 | Angled walls | **Partial** | **RE-RATED 2026-10-15, and the Missing was my own error.** It read *"the S06 overlay shows a 45° wing returning nothing"* — true, and the wing returned nothing because `NOT_A_BOX` was discarding the WHOLE SHEET (item 11's lane), not because 45° fails. With that removed the wing returns 5 of 9 runs at 45°/135°, thicknesses 4.5–6.5in. A symptom of another defect, read as a capability gap | accuracy ungraded — no fixture prints a wall length | M |
| 14 | Curved walls | **Partial** | **RE-RATED 2026-10-16, 0 → 50.** `curvedWalls.ts` assembles a polygonised arc into a chain and measures the CENTRELINE ARC — the mean of the two faces' path lengths, which is an identity for concentric faces, so no arc is fitted. S07's bay (chord 12.0 ft, arc 14.17) went from contributing NOTHING to the sheet scoring −1.8%. The discriminator is SHAPE, not the `curved` flag: that flag records a Bézier THIS renderer flattened, and S07's bay is 202 straight 0.15 ft pieces with the flag on none of them — filtering on it found every arc on the page except the wall. 12 tests, 8 mutations, 7 red and the eighth noted as unproven | **not Done:** `MAX_PIECE_FEET` (1.5 ft) excludes coarsely-flattened arcs — the bench's lobby arc is 2.5 ft pieces and still goes through the pairer at 22.8 ft. Filled curved poché is untested; no fixture has one | M |
| 15 | Corners / T-junctions | **Partial** | bench P5 passes (one-face-one-use) | **P15 fails** — a group collapses to ONE run, so stud counts are wrong | M |
| 16 | Exterior vs interior | **Missing** | no module, no field | everything | M |
| 17 | Type/thickness grouping | **Partial** | `clusterByThickness`, `wallTypeMatch` wired | **P14 fails** — 4-7/8" and 4-3/4" merge into one group | S |
| 18 | LF gross and net of openings | **Partial** | gross only; `openings.ts` is **engine only** | net | M |
| 19 | Wall area (LF × height) | **Missing** | no height source, no area field | everything | M |
| 20 | Ignore clutter | **Partial** | filters exist; the S08 sofa and the S13 grid stubs are GONE (`gridBubbles` wired in, 2026-10-15) and both overlays are clean; still Partial because no fixture scores footage, so completeness is unproven. Originally: S13 traces washroom fixtures and runs past the building at two gridlines | **0 of 36 zero-wall sheets produce walls UNFLAGGED** now (was 11/36 at up to 2,406 ft); 31 more produce walls on sheets `sheetSuitability` cautions about, which is the bar being met rather than cleared | L |

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
| **Walls** (11–20) | 25% | 50+50+50+**50**+50+0+50+50+0+50 | 400/10 | **40.0%** | 10.00 |
| **Openings** (21–23) | 10% | 60 + 60 + 50 | 170/3 | **56.7%** | 5.67 |
| **Rooms** (24–30) | 15% | 60+60+50+0+0+0+0 | 170/7 | **24.3%** | 3.64 |
| **Review UI** (38–44) | 15% | 0+100+50+50+100+100+50 | 450/7 | **64.3%** | 9.64 |
| **Integration** (45–48) | 10% | 100 + 50 + 0 + 100 | 250/4 | **62.5%** | 6.25 |
| **Intake** (1–5) | 5% | 100+100+50+100+**100** | 450/5 | **90.0%** | 4.50 |
| **Scanned** (31–33) | 5% | 0 + 50 + 60 | 110/3 | **36.7%** | 1.83 |

**TOTAL = 53.8%** (50.3% at the audit → 51.6% after Steps 1–3 → 52.1% after Step 4 → 52.6% with the view split → **53.8%** with curved walls, 2026-10-16. FOUR ratings have moved in seven steps: item 13 from 0 to 50, item 5 from 0 to 50 to 100, item 14 from 0 to 50. Everything else sat INSIDE items already scored Partial, which is a property of a 0/50/60/100 scale rather than a measure of the work: the twenty went from 1 of 17 within ±2% to 13 of 17 and the bench's type-totals from 28/60 outside to 17/60, and neither moved a single rating. `reports/takeoff-bench/SCORECARD.md` is the finer instrument, and the fixture evals finer still.)

---

## Five general fixes, 2026-10-16

Measured on BOTH sets after each one, because a fix that helps one and hurts
the other is not a fix. Re-run `truthScore.eval.ts` and `pnpm takeoff:bench`
rather than trusting this table.

| | the twenty, within ±2% | bench type-totals outside ±2% | bench walls missed | holdout |
| --- | ---: | ---: | ---: | ---: |
| start of the day | 1 of 17 | 26 of 60 | 113 | −2.1% |
| hatch series needs two members | 9 of 17 | 17 of 60 | 111 | −0.5% |
| inclusive opening cap | 10 of 17 | 17 of 60 | 111 | −0.5% |
| rule 5 removed (scale) | 12 of 17 | 17 of 60 | 111 | −0.5% |
| duplicate coverage | 12 of 17 | 17 of 60 | 111 | −0.5% |
| curved walls | **13 of 17** | **17 of 60** | **111** | **−0.5%** |

### Where the twenty stand

| id | found | key | err | | id | found | key | err |
| --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: |
| S01 | 80 | 80 | +0.0 ✅ | | S10 | 188 | 188 | +0.0 ✅ |
| S02 | 237 | 240 | −1.2 ✅ | | S11 | 161 | 166 | −3.0 |
| S03 | 237 | 240 | −1.3 ✅ | | S12 | 457 | 468 | −2.3 |
| S04 | 396 | 396 | +0.0 ✅ | | S13 | 576 | 576 | +0.0 ✅ |
| S05 | 307 | 310 | −0.9 ✅ | | S14 | 611 | 584 | +4.7 |
| S06 | 188 | 188 | +0.0 ✅ | | S15 | 206 | 206 | +0.0 ✅ |
| S07 | 196 | 200 | −1.8 ✅ | | S16 | 238 | 241 | −1.2 ✅ |
| S08 | 475 | 464 | +2.3 | | S17 | 251 | 251 | +0.0 ✅ |
| S09 | 356 | 356 | +0.0 ✅ | | S18–20 | — | — | NOT SUPPORTED |

S18–20 are scans and count as NOT SUPPORTED, never as a pass — group J's
scanned items carry that, and `truthScore.eval.ts` prints them that way.

### The four that still fail, diagnosed

All four are the SAME remaining defect plus one outlier, and the numbers come
from the eval's own opening tally rather than from reading overlays:

- **S08 +2.3%** — bridges 16 of 28 openings, 53 of 106 ft. Its 8.40in phantom
  is gone; two orphan clusters remain (3.60in over 6 ft, 2.40in over 2 ft),
  which are window GLAZING lines pairing with each other inside an opening.
- **S11 −3.0%** — bridges 4 of 8 openings. W7 is a 14 ft wall with a 2.5 ft
  and a 4.0 ft door, read as 9.0 ft.
- **S12 −2.3%** — bridges 10 of 16. W13 is the outlier: a 16 ft wall with NO
  openings, read as 8.7 ft, so it is not an opening problem.
- **S14 +4.7%** — bridges 9 of 14, and its orphan clusters (3.38in over 112 ft,
  16.88in over 27 ft) are REAL wall measured at the wrong thickness. See
  `duplicateCoverage.ts`: 160 + 112 is exactly the 272 ft of 4.5in its key
  declares, which is why dropping an orphan thickness costs 19%.

**Window glazing is the next lever and it is worth about 50 ft on S08 alone.**
A window is drawn with three lines across its opening; two of them are 0.32 ft
apart, which is 3.8in and inside the partition window, so each window yields a
phantom run AND leaves the real wall's pieces unbridged. Not attempted here.

---

## Two attempts that were built, measured and reverted, 2026-10-16

Both are recorded because each one cost a day's worth of measurement and each
one is the obvious next thing to try. Neither is in the tree.

### The glazing lever — it works, and it costs 21 bench walls

**What a window is, measured rather than assumed.** S02's 6-1/2in exterior wall
with a 4 ft and a 5 ft window in it:

    y -49.22   wall face    19.6-25.5   33.0-49.0   54.0-63.8
    y -49.10   glazing                  25.5-29.5   49.0-54.0
    y -48.94   glazing                  25.5-29.5   49.0-54.0
    y -48.78   glazing                  25.5-29.5   49.0-54.0
    y -48.68   wall face    23.8-25.5   33.0-49.0   54.0-63.2

The outer two glazing lines are 0.32 ft apart — 3.84in, squarely inside the
partition window — so they PAIR, and their centre lands 0.01 ft from the real
wall's centre, so `mergeWalls` reads the phantom as the same line and FILLS the
window instead of bridging it. Gross comes out about right, which is why it
hid; no opening is recorded, which is the half a bid prices.

**"Two or three thin lines" is NOT the test**, and that was the first thing
tried. S11's 12in wall carries a 5 ft window drawn with ONE line:

    y -10.44   wall face    15.0-20.0   25.0-44.0
    y -10.24   glazing                  20.0-25.0

What holds on both, and counts nothing: the glass lies STRICTLY BETWEEN the
two faces, and it is CONFINED TO THE GAP. The second is what separates it from
a wall CENTRELINE, which also sits between the faces and also covers the gap —
but runs the whole wall.

**THREE BUGS WORTH KEEPING, because any future attempt hits all three.**

1. **Confinement is per SPAN, not per LINE.** Asking whether the glazing line
   has coverage outside this gap is wrong: one glazing line serves EVERY window
   on its wall. S08's spans four, so each window disqualified the other three
   and the sheet with 28 openings reported ZERO windows.
2. **The window cap must BE `MAX_OPENING_FEET`, not a number of its own.** The
   point of removing the glass is to leave a gap `mergeWalls` will bridge, and
   it refuses anything wider than that cap — so above it the glass goes and the
   wall still does not bridge. At 12 ft this called a 9.8 ft span on S17 a
   window and took the sheet from +0.0% to -3.9%.
3. **The two line families must actually BE one wall.** Any two parallel lines
   a partition apart satisfy the search, and a dense sheet has many — a
   detail's hatching against a section line, two walls across a thin closet.
   The "gap" between such a pair is not an opening, and a real face between
   them was deleted as its glass.

**WHAT IT BOUGHT, and it is a lot.** Openings bridged across the seventeen:

    | | openings | by width |
    | baseline | 130 of 218 | 417 of 862 ft |
    | with glazing removed | **205 of 218** | **795 of 862 ft** |
    | …plus the lineweight test | 182 of 218 | 656 of 862 ft |

S08 alone went from 16 of 28 openings (53 ft) to 27 of 28 (103 ft). Gross did
not move: 13 of 17 throughout.

**WHAT IT COST, and why it is not in the tree.** The 60-page bench:

    | | type-totals outside 2% | walls missed |
    | baseline | 17 of 60 | 111 |
    | with glazing removed | 21 of 60 | 132 |
    | …plus the lineweight test | 19 of 60 | 125 |

Twenty-one real walls on the adversarial set, fourteen with lineweight added.
That fails the standing rule — a fix must improve or hold both sets — so it was
reverted whole rather than argued down. Trading gross accuracy, which is what a
quantity rests on, for net accuracy is the wrong direction even at this ratio.

**LINEWEIGHT IS CONFIRMED AS A REAL SIGNAL THAT IS NOT SUFFICIENT.** Measured:
S08 draws wall faces at 0.80pt and glazing at 0.25-0.35pt, a 2.3-3.2x gap. As a
second requirement it recovered 7 of the 21 lost walls. It cannot be the
discriminator, because S13 draws some wall faces at 0.35pt — the same pen as
S08's glass. `StrokeSegment.width`'s own comment says whether it discriminates
was being measured rather than assumed; this is the measurement, and the answer
is "partly".

**WHAT THE NEXT ATTEMPT NEEDS:** which bench lines are being eaten. That was
not established — the bench attributes missed walls by cause, but no cause
names this path, so identifying them means instrumenting the 21 and reading
them one at a time.

### Wiring the view split into the bench — the key is whole-sheet

The scorecard reports A-401 as `SCALE WRONG_CONFIDENT` and says its ENLARGED
STAIR PLAN would be measured at 2.00x the truth, while the app splits that
sheet correctly. So the bench grades a worse pipeline than the one that ships —
the same drift `harness.ts`'s own header was written about.

Wiring `wallsPerView`/`primaryView` into `findWalls`, gated at two or more
views exactly as `TakeoffPlanViewer.tsx` gates it, made the grading WORSE:

    | | A-401__clean walls | A-401 LF | bench walls missed |
    | whole sheet | 11 found / 1 missed of 12 | 367 of 370, -1.0% | 111 |
    | split | 5 found / 2 partial / 5 missed | 538 of 370, **+45.5%** | 139 |

**The cause is structural, not a bug in the wiring: the bench's A-401 key is
WHOLE-SHEET.** Scoring a primary-view measurement against a key that covers
every in-scope wall on the page compares two different quantities, and no
amount of care in the split fixes that.

So the choice is between two things, and it is not mine to make:

  - **report** the split alongside the whole-sheet score, so the scale verdict
    stops reading as a flat WRONG when the app reads both views — cheap, and
    leaves the LF column measuring what it measures today;
  - **build per-view keys** for A-401, which makes the split scoreable and is
    the only version that answers "is the stair measured correctly".

Reverted meanwhile. `benchMultiView.eval.ts` already prints the per-view
figures (RESTROOM 1/4" 647 ft, STAIR 1/2" 386 ft, all six variants identical),
so the numbers exist today without the scorecard claiming to grade them.

---

## Step 6 — the real-plan check, 2026-10-16

### THERE ARE NO REAL PLANS IN THIS REPO, AND THAT BOUNDS EVERYTHING ABOVE

Asked for directly, so it is answered directly. Every PDF in the repo is in
one of four places and none of them is a real drawing:

| where | what | provenance |
| --- | --- | --- |
| `lib/takeoff/fixtures/plans` | the twenty, S01–S20 | generated by `fixtures/generator/generate.py` |
| `reports/takeoff-bench/fixtures/pdf` | 90 files, A-101 … S-101 | generated by `bench/writers.ts` |
| `apps/web/e2e/fixtures` | `wide-sheet.pdf` and friends | written by the e2e harness |
| `apps/lien-waiver/statutes/raw` | statutes | not drawings |

The real-plan evals (`realplan/layers.eval.ts`, `realplan/sheetTemplate.eval.ts`)
read `REAL_PLAN_PDF`, which points OUTSIDE the repo and is unset here. So every
figure in this file is measured on drawings a program wrote, and the one honest
sentence about carry-over is that nobody has checked it.

Two things make that less bad than it sounds, and neither makes it good. The
bench's 90 files come from a DIFFERENT generator than the twenty, through four
writers (clean, AutoCAD, Revit, Skia) with clip paths, dash patterns, optional
content, SHX text, rotation and half-size reductions — so a fix that holds on
both sets has survived two independent idea of what a drawing looks like. And
the fixture keys are the generator's own geometry rather than a measurement,
so they cannot flatter the detector.

What a real set would test that neither does: line weights that mean something,
hand-added revision clouds, xref'd backgrounds, text as outlines, arcs
polygonised by someone else's tolerance, and the pure volume of annotation a
60-page issue carries.

### A-401, the nearest thing to a real sheet

The bench's multi-view sheet, read through the same pipeline. Wall footage is
good and the phantoms are the story — and because this fixture carries CAD
layer names, the bench can say exactly what each phantom is:

| | A-401__clean |
| --- | --- |
| in-scope LF | **367 of 370 centreline = −1.0%** |
| walls | 11 found, 0 partial, 1 missed of 12 |
| phantom | **7 runs, 120 ft** — detail (`A-DETL`) 65 ft, stair (`A-FLOR-STRS`) 34 ft, dimension (`A-ANNO-DIMS`) 18 ft |
| missed | 49 ft over 2 walls to `inAHatchSeries`; 2 ft under the run floor |
| scale | names 1/4" for the page; ENLARGED STAIR is 1/2", so that view reads 2.00× |

Three findings, in the order they cost the most:

1. **Detail and stair linework is 99 of the 120 phantom feet.** Neither is a
   wall and both are wall-shaped. The layer names would settle it outright,
   and `layerNames` already does on `A-401__layers` — which is why that
   variant finds 15 runs where `clean` finds 16.
2. **`inAHatchSeries` is still the largest single cause of missed wall on the
   bench**, 49 ft on this sheet alone, after two commits spent on it today.
   The rule is better and it is still the top of this list.
3. **Dimension lines still become walls, 18 ft here.** `duplicateCoverage`
   removes a dimension string that DUPLICATES a wall, which is what S08 had.
   It does nothing about one standing on its own in open paper, and this
   sheet has 18 ft of exactly that.

### What the split gives on it, and the gap that matters

`benchMultiView.eval.ts`, run today: A-401 splits into three regions and names
two measurable views —

    ENLARGED RESTROOM PLAN   1/4" = 1'-0"   16 runs   647 ft   (primary)
    ENLARGED STAIR PLAN      1/2" = 1'-0"   10 runs   386 ft

against a whole-sheet baseline of 20 runs and 716 ft at one scale. All six
A-401 variants split identically, including the half-size reduction.

**The bench harness does not use that path**, so the scorecard above still
reports the stair at 2.00× the truth. The app does (`TakeoffPlanViewer.tsx`
imports `primaryView`, `wallsPerView`, `excludedViews` and the cautions), and
`e2e/specs/multi-view.spec.ts` clicks it in a real browser. So the bench's
scale verdict on A-401 understates what an estimator is shown — and the two
instruments disagreeing is itself worth fixing, because the bench is what
anybody will read first.

---

## Scored against the keys, 2026-10-16

`lib/takeoff/fixtures/keyScore.eval.ts` prints this; re-run it rather than
trusting the table.

### THREE COLUMNS THAT CANNOT EXIST, AND WHY THAT IS RIGHT

`wallLfTotal`, `doorCount` and `windowCount` are **null on all twenty keys**,
and `expected.test.ts` fails the build if any is filled in. Its own words:
*"The day somebody fills these in by measuring the drawing with the detector
under test, the key stops being evidence and becomes an echo."*

So there is **no wall-length target in this set** and no % error to compute
against one. `reports/takeoff-bench` is the set that has per-wall truth.

### WHAT IS DERIVABLE, AND IT IS A FLOOR NOT A TARGET

The keys carry each sheet's printed dimension strings. The two largest are the
footprint's bounding box, and for any rectilinear footprint the exterior wall
run is **at least** that box's perimeter — an L or a U has more, never less.
Interior partitions sit on top and are printed nowhere, so there is no upper
bound. Walls are measured at centreline, so the box is pulled in by one wall
thickness a side: `2(W + H) - 4t`, with `t` the median thickness that sheet's
own walls were found at.

A sheet BELOW that is under-reporting its own envelope. A sheet above has
passed the only check this set can make. It is a weak test, honestly weak, and
it is what caught S11 reporting 92 ft against a printed 108 ft perimeter.

### Every plan

| id | scale | verdict | LF ft | floor | vs floor | views | LF change |
| --- | --- | --- | ---: | ---: | --- | ---: | --- |
| S01 | 1/4" | PASS | 78 | 80 | **FAIL −3%** | 1 | 0 → 78 |
| S02 | 1/4" | PASS | 223 | 137 | PASS +63% | 1 | 223 → 223 |
| S03 | 1/8" | PASS | 223 | 137 | PASS +63% | 1 | 223 → 223 |
| S04 | 1/4" | PASS | 353 | 181 | PASS +95% | 1 | 364 → 353 |
| S05 | 3/16" | PASS | 271 | 127 | PASS +112% | 1 | 275 → 271 |
| S06 | 1/4" | PASS | 171 | 152 | PASS +12% | 1 | 0 → 171 |
| S07 | 1/4" | PASS | 158 | 131 | PASS +20% | 1 | 162 → 158 |
| S08 | 1/4" | PASS | 390 | 193 | PASS +102% | 1 | 406 → 390 |
| S09 | 1/4" | PASS | 287 | 165 | PASS +75% | 1 | 300 → 287 |
| S10 | — | **OPEN** | 175 | 120 | PASS +46% | 0 | 0 → 175 |
| S11 | 1/8"→1/4" | PASS conflict | 154 | 104 | PASS +48% | 1 | 0 → 154 |
| S12 | — | **OPEN** | 384 | 209 | PASS +83% | 0 | 387 → 384 |
| S13 | 1/8" | PASS | 575 | 241 | PASS +139% | 1 | 555 → 575 |
| S14 | 1/8" | PASS | 609 | 324 | PASS +88% | 1 | 608 → 609 |
| S15 | 1/4" | PASS | 167 | 128 | PASS +31% | **2** | 0 → 167 |
| S16 | 1:100 | PASS | 223 | 139 | PASS +60% | 1 | 223 → 223 |
| S17 | 1:50 | PASS | 177 | 166 | PASS +7% | 1 | 181 → 177 |
| S18-20 | — | PASS decline | — | — | — | 0 | — |

**Scale: 18 of 18 scored correct.** 14 printed, 1 conflict (S11), 3 raster
declines. Scored through `scaleAuthority` — a first version compared every
sheet against `key.scale` and produced THREE FALSE FAILURES, because S11's own
note says *"Scale is NOT scored here; what is scored is that the app reads the
dimensions and says the two disagree."*

**Printed floor: 16 of 17.**

### The one that fails, and it is not a regression

**S01, 78 ft against a floor of 80.** Its box is 24'-6½" × 16'-7¼", so the
outside perimeter is 82.3 ft and the centreline perimeter about 80.0.

The 2 ft is **corner clipping, and the arithmetic lands on it exactly**.
`wallFromPair` clips a centreline to the OVERLAPPING span of its two faces, so
each wall end loses about half a thickness. Four walls, eight ends, t = 0.57 ft:
`8 × 0.285 = 2.3 ft`, and `80.0 − 2.3 = 77.7` against 78 found.

It is systematic, it affects every plan, and it is invisible on the other
nineteen because interior partitions swamp it. S01 is simply the first
one-room plan this app has ever measured — before this work it returned zero.
Not caused by any change here; now visible because of them.

### The two that are OPEN

S10 and S12 print no scale (`scaleAuthority: "none"`) and their notes say *"the
app must DECLINE rather than guess"*. The app does not decline — it measures
the dimensions those sheets DO letter and reads 1/4" and 1/8". That is not a
guess, and it may well be better than declining.

`score.eval.ts` leaves these unscored, which hides the question. They are
recorded as OPEN because the key's wording and the app's behaviour disagree and
**nobody has decided which is right.** It is a one-line decision, not a defect.

### Which plans pass every target

**17 of 20**: S02-S09, S11, S13-S17 on both scale and floor; S18-S20 on their
declines. **1 fails**: S01, on the floor, by the corner clipping above.
**2 open**: S10 and S12, on the decline question.

### The next three gaps, by the audit's own weights

`weight x (100 - group %)` — the points each group has on the table:

| group | weight | now | points available |
| --- | ---: | ---: | ---: |
| **Walls** (11-20) | 25% | 35.0% | **16.25** |
| **Rooms** (24-30) | 15% | 24.3% | **11.36** |
| **Review UI** (38-44) | 15% | 64.3% | **5.36** |
| Openings (21-23) | 10% | 56.7% | 4.33 |
| Integration (45-48) | 10% | 62.5% | 3.75 |
| Scanned (31-33) | 5% | 36.7% | 3.17 |
| Scale (6-10) | 15% | 82.0% | 2.70 |
| Intake (1-5) | 5% | 90.0% | 0.50 |

1. **Walls, 16.25 points.** Still the largest by a wide margin even after this
   work, because five of its ten items are 0: curved walls, exterior-vs-interior,
   wall AREA, and LF net of openings. None is hard; none is started.
2. **Rooms, 11.36 points.** The pipeline reports **no room list at all**, while
   every key carries one (1 to 13 rooms a sheet) — so this is the one gap with
   ground truth already sitting in the repo, unused.
3. **Review UI, 5.36 points.** Item 38 is 0: there is no set-level "run takeoff"
   with per-sheet progress, so a 60-page set is driven one sheet at a time.

**This does not match the expectation that rooms, openings and scanned would be
the top three.** Openings is 4th (4.33) and scanned 6th (3.17) — both are 5-10%
groups, so even finishing them outright moves the total by less than fixing
rooms. The arithmetic is above; it is the same formula, run on the same weights.

### Verified in a browser, not just asserted

`e2e/specs/multi-view.spec.ts` — real Chromium, real Clerk sign-in, throwaway
Postgres, steps 6-17 of the click-list. 5 of 5 passing. Screenshots in
`e2e/artifacts/multi-view/`.


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
