# Scanned plans — the third lane's research notes (2026-10-27, `diego/scanned-plans`)

A scanned sheet is a bitmap: no path operators, so `sheetStrokes` returns
nothing and the wall finder has nothing to pair. This branch measures how far
the existing finder gets when the lines are read off the bitmap instead, on
the training sheets that already have answer keys. No product UI. No finder
file changed.

## 1. The test bench

The training sheets are vector, and they have keys. So each one is
RASTERISED the way a scanner would see it and scored against its own key:

| step | what | where |
| --- | --- | --- |
| render | the page at 150 / 200 / 300 dpi, 8-bit grey PGM | `realplan/scanTool.swift render` (PDFKit) |
| scan-like | skew 0.7°, speckle 0.4% of pixels, 3×3 blur, seeded | `raster/rasterDegrade.ts` |
| lines | ink pass + fill pass → segments in points | `raster/rasterLines.ts` |
| deskew | tilt from the long lines, page turned back, lines read again | `estimateSkewDegrees` + `skew` |
| text | tiled Vision OCR → `{str, x, y, width, height}` in points | `scanTool.swift ocr` |
| scale | the OCR'd caption through `printedScalesOnPage` + `scaleFromPrinted`; the key's scale as a flagged fallback | existing readers |
| detect | `detectForSheet` → `offeredCandidates`, exactly the vector path | existing |
| score | `scoreSheet` against `keyFromLabels` (accepted + traced) | `heldOutScore.ts` |

Held-out sets are refused by name (`heldOutReason`). 26 training label
sheets, 26,900 key ft. Diagonal key footage (more than 5° off an axis) is
65 ft — 0.2% — so an axis-only line pass is not what limits recall.

## 2. How the raster pass works, and what it is not

Binarise, walk every row for runs of ink longer than 0.15 in, merge runs that
sit on each other row after row into bands; same for columns. A band is one
segment from the row its ink starts on to the row it ends on — flat on a
square scan, tilted on a skewed one, which is what the tilt estimate reads. A
thick band whose rows are all full is a FILL and becomes its two faces, the
pair a drawn wall would have produced. The fill pass runs separately, on a
blurred copy at a looser threshold (245 of 255), because the ink threshold
(200) that reads lines misses light-grey poché and a threshold loose enough
for poché reads a scan's speckle as line work: measured 2,300 ft of junk on
one sheet with one threshold for both.

Not Hough, not LSD: one pass over the pixels, one threshold and one length,
and it degrades gracefully with tilt. Not a morphological closing either —
tried as gap bridging, and it merged parallel lines across their gap.

**Known limit, measured and left.** Lettering inside a grey room splits that
row's run, so a filled room comes out as several bands and the fill pass
draws an edge at every line of text (A100's existing wing). Letting a band
take several runs per row was tried and merged the rooms ACROSS the walls
between them — found footage fell by two thirds. The fix is a contour of the
fill rather than runs; that is production work (OpenCV `findContours`), not
a tweak.

## 3. Results (26 training sheets, 26,901 key ft; full tables in `shots/scanned/REPORT.md`)

| stack | arm | real ft | real % | junk ft | scale by OCR | median s |
| --- | --- | --- | --- | --- | --- | --- |
| — | vector finder | 23,793 | 88% | 13,014 | — | 2.4 |
| mac (PDFKit + Vision) | 150 / 200 / 300 clean | 19,435 / 20,340 / 19,839 | 72 / 76 / 74% | 33k / 29k / 28k | 22 / 22 / 20 of 26 | 2.6 / 3.5 / 5.5 |
| node (pdf.js + Tesseract) | 150 / 200 / 300 clean | 19,686 / 20,384 / 19,243 | 73 / 76 / 72% | 42k / 33k / 28k | 14 / 19 / 17 of 26 | 8.6 / 10.6 / 15.7 |
| mac | scan-like | | 65 / 63 / 64% | | 11 / 18 / 16 | |
| node | scan-like | | 58 / 62 / 71% | | 6 / 11 / 13 | |

The Linux stack reproduces the Mac numbers within two points; its OCR
reads fewer captions and takes most of the time. Contour fills raised
recall 5 points over run fills at every dpi and cut Baker A100's junk from
787 to 189 ft while moving its recall only from 607 to 679: the wing's
faces are found but sit a few pixels off the drawn line, which the finder's
thickness pairing refuses — a tolerance for the finder lane. 200 dpi is
the sweet spot. Diagonal key footage is 0.2%.

## 4. Cost and speed

Node stack per sheet: 8.6 s at 150 dpi (Tesseract 7.0), 10.6 at 200, 15.7
at 300; no model called. CPU on the ingest runner, inside its 45 s budget.
OCR of only the bottom band and title block would halve it.

## 5. Productising — the plan (2026-10-27, after the Linux stack and the contour fills)

**What runs where.** Everything in `lib/takeoff/raster/` is pure TypeScript.
The render is `pdfjs-dist` with its Node canvas (`@napi-rs/canvas`, prebuilt
for linux-x64/arm64, already in the lockfile under pdf.js) and the OCR is
`tesseract.js` (WASM, already a dependency). No native build, no Apple
framework, no new package. `scanTool.swift` stays as the research arm.

**1. Ingest knows a scan.** `PlanSheetText.hasTextLayer === false` plus
`sheetStrokes(...).pathOperators === 0` on a non-blank page is "image only".
The page inventory already records the first; the second is one read per
page the WALLS stage already does. Store nothing new: derive "scanned" from
those two at read time.

**2. A background stage, not a click.** The whole-set stage (PR D) runs
`detectWallsForCalibration` per sheet under the ingest runner; a scanned
sheet takes the raster road inside that same call: render at 150 dpi (no
gain above 200, measured), lines + deskew, Tesseract on tiles for the scale
caption, `detectForSheet`, the same `TakeoffWallProposal` rows. 150 dpi fits
the runner's 45 s budget with room (node stack: ~8 s per sheet of which
~5 s is Tesseract). The viewer's own "Find the walls" on a scanned sheet
does the same in the browser — pdf.js already renders there, Tesseract runs
in the browser — or defers to the server; decide on the first real scan.

**3. The estimator sees it.** Per sheet, a caution in the sheet picker and
over the found-walls panel: *"Scanned sheet — walls were read from the
image, not the drawing's lines. Check each group against the sheet before
adding it."* The groups list carries a `scanned` flag so the e2e and the
export can tell. No new table: the flag is derived (item 1).

**4. Scale.** Tesseract's caption through `scaleFromPrinted` first (22/26
clean sheets at 150 dpi with Vision; the Node run's count is in the report);
on a miss, the existing set-the-scale prompt. A vision-model call only if
the Tesseract miss rate on REAL scans is too high — one small call on the
title-block crop, priced from the model list at the time, never on the whole
sheet.

**5. Behind a switch, OFF**, like rooms and the export: `Company.scannedPlansOn`.

**6. What we need from a real scanned set before trusting any of this.**
Every number here is from vector sheets rendered and degraded by code. A
real scan differs in ways the bench cannot make: halftone and dither in the
greys (the fill pass reads a dither as line work), JPEG blocking, uneven
lighting, a photographed page's perspective, bleed-through from the back of
the sheet, and hand-drawn or redlined sets. The ask: five of the TRAINING
sheets that already have keys — Baker A101, ELEVEN03 A4.B.1, Camp Clark
A-101, Topeka p75, Joplin A-101 — printed and scanned on an office scanner at
150 and 300 dpi, greyscale, plus one photographed with a phone. Scored
against the same keys by the same bench (`SCAN_EVAL_STACK=node` with the
scan as the input instead of a render — a one-line change). That run is the
go/no-go for items 2 and 3.

**7. Not planned now.** Diagonal and curved walls (0.2% of key footage);
text other than the scale and the sheet number (room tags on scans would
need the OCR positions the room finder reads, which Tesseract gives — a
later step); the "no view kept → whole sheet" fallback in `detectForSheet`
(the original session's, coordinated in log.md).

## 6. Productized (2026-10-27, `diego/scanned-sheets` off main, switch OFF, not merged)

| piece | where |
| --- | --- |
| ingest marks a scan | `pageInventory.ts` counts path and image operators for a page with no text layer onto `PlanSheetText`; `scannedSheet.ts` derives the verdict |
| the stage | `PlanIngestStage.RASTER`, `plan-ingest/raster.ts` (`rasterWork`, `scannedPageNumbers`, `storedRasterFor`), per page `raster/rasterizeSheet.ts` at 200 dpi → `PlanSheetRaster` (lines, text, printed scale, in points) |
| the finder reads it | `detectWallsForCalibration` and the viewer's Find the walls take the stored lines and words when a page has them (`rasterByPage` from `workspaceLoad`) |
| the estimator | the viewer's caution on a read sheet; the OCR'd scale as the calibration prefill where the inventory has none, else the ordinary set-the-scale prompt; `ScannedSheetsPanel` reads the unread scans in one press |
| the switch | `Company.scannedPlansOn`, `ScannedPlansSwitch` on Settings, `saveScannedPlansSwitch` |
| tests | `scannedSheet.test.ts`, `raster/*.test.ts` (incl. a pdf-lib ARCH D sheet rendered and read with OCR stood in for), `plan-ingest/raster.test.ts`, `actions/scannedSheets.dbtest.ts` (switch, task scoping, the stored row, the page load) |

**Server budget.** One sheet per advance of the runner; the pdf is opened,
rendered and destroyed inside the task, and the canvas is dropped before
the lines are read, so nothing is held between pages. The numbers from
`realplan/rasterStage.eval.ts` on 50 pages of a training set are in §7.

**Not done, by design.** A scan with an embedded OCR text layer counts as a
drawing (it has text) and takes the vector road, which finds no strokes —
the page inventory could count operators for every page at the cost of one
operator-list read per page; left until a real set shows it matters. Room
tags on scans (the words are stored; the room finder does not read them
yet). The "no view kept → whole sheet" fallback in `detectForSheet` stays
with the original session. Validation on REAL scans waits for Diego's sets.

**Deferred e2e.** Settings switch on → the panel appears on a set with a
scan; press Read → the count climbs to done; open the sheet → the caution
shows and Find the walls offers groups; a sheet whose caption OCR read has
the one-press scale, one it did not shows the set-the-scale prompt.

## 7. Time and memory per sheet, measured (2026-10-28, `realplan/rasterStage.eval.ts`)

Baker EOC, the first 50 pages, every page read as if it were a scan, at
200 dpi with Tesseract, one page after another in ONE Node process on this
Mac, nothing else running. Raw rows in `shots/scanned-stage/{v1,v6}/`.

| | before the mitigations | after |
| --- | --- | --- |
| per sheet, median / mean | 8.8 s / 12.6 s | **6.1 s / 7.3 s** |
| per sheet, p90 / worst | 33 s / 45 s | **12.5 s / 17.4 s** (one sheet over 15 s: S2.0, dense small text) |
| Tesseract, median / worst | 7.7 s / 42 s | 4.8 s / 16 s |
| sheets whose number or title stopped OCR after the title block and bottom band | 0 | 31 of 50 |
| resident memory after a sheet, median / high-water | 846 MB / 2,027 MB | 756 MB / 1,188 MB |
| resident memory mid-sheet, worst | not sampled | 1,663 MB (A401, after the lines step) |
| lines found, per page | — | within 0.14% of before (band seams), scale read on 24 vs 26 |

**What the mitigations were.** The render draws the page in 600-px bands
into one reused canvas instead of a 138 MB full-page RGBA canvas, and the
page's pdf.js caches are dropped after it. OCR cuts its tiles straight from
the 8-bit grey into ONE reused tile canvas, never a full-page RGBA copy.
OCR reads the title block and the bottom band first, puts the sheet's own
number and title to `takeoffSheetVerdict`, and reads the rest of the page
only for a floor plan or a sheet it cannot name — a cover, a schedule, an
elevation sheet stops there with its lines kept. One Tesseract worker per
sheet, not one per pass. The lines are the same code at the same dpi, so
recall is unchanged by construction; the stage's own step scored on the
training keys is in §8.

**Tried and left out, measured:** a second pass over the title block at
half size, for the big numerals Tesseract misses — read nothing new on
Baker and cost 5–7 s a sheet. Tesseract reads the sheet number on 1 of 50
Baker pages at any size; the early stop goes by the title words it does
read ("COVER SHEET", "SCHEDULE"), which is why 31 sheets stop and the
floor plans do not.

**The memory target, honestly.** Under 1 GB was the target; 1.19 GB
after-sheet high-water and 1.66 GB mid-sheet is what fifty sheets back to
back in one process reach. The JS heap never passes 190 MB; the rest is
typed-array garbage the collector has not reclaimed yet plus pdf.js's and
the WASM worker's native memory, and a process keeps its high-water mark.
A single sheet's working set is 450–760 MB. So the server-side answer is
ISOLATION, not another buffer: one sheet per process. On Vercel each
advance is already its own invocation; what the number warns about is a
Fluid instance reused across many advances, which then carries the
high-water mark. Running `rasterizeSheet` in a `worker_threads` Worker that
is terminated after each sheet returns the WASM heap and the typed arrays
with it; a child process does the same more surely. Neither is built here
— a worker entry has to survive the Next build, which only a preview can
prove — and the stage runs one sheet per advance meanwhile, which is the
450–760 MB case, inside a 1 GB function.

## 8. The whole-sheet fallback (2026-10-28)

`wholeSheetFallback` in `offeredCandidates.ts`, in `detectForSheet`'s
multi-view branch only: when drawings were found, none could be measured,
and none was set aside for a NAMED reason (notes, legend, schedule,
elevation, section, detail), the whole sheet is measured as one drawing and
the caution says so ("check each group against the sheet"). A drawing the
caption reader could only mark "check it", or could not scale, is not a
named reason — that is the shape OCR noise takes. Baker A201 names all its
views and stays at zero. Pure rule, four tests.

**The 31-sheet vector sweep is byte-identical** before and after
(`shots/scanned-stage/sweep/sweep-{before,after}.json`, `cmp` clean).

**It does not fire on the four bench cases, and here is why.** With the
contour fills and line-level OCR now on the branch, the zeros that named
those cases are gone or have another cause:

| case | stack | before the fallback | the view path says |
| --- | --- | --- | --- |
| Joplin A-101, 150 dpi | Tesseract / Vision | 4,887 / 4,585 ft found | views kept |
| Murray A101, 150 dpi | Vision | 126 of 1,037 ft | views 6, kept 2 ("or Plan", "1st Floor Plan") — region placement, not an unkept view |
| NG McAllen A3.2, 300 dpi | Tesseract / Vision | 759 / 1,646 ft | views kept |
| Bunkie A100, 300 dpi | Vision | **0 of 470 ft** | views 2, kept none, leftOut "Equipment: an equipment plan, not to scale" + legends — every view NAMED, so by the rule it stays at 0 |

Over all 26 training sheets at 150 and 300 dpi, clean and scan-like, on
the Mac stack: the fallback fired on none, and every arm's footage is
unchanged. Bunkie's zero is the one worth a decision: the floor plan's
caption was read as the equipment plan's, so the only drawing left is
"not to scale" and named. Treating a not-to-scale exclusion on a SCANNED
sheet as unnamed when the sheet's scale is already known would measure it
— a widening of the rule that is Diego's call, not made here.
