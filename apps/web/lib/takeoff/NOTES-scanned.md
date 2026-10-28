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

## 7. Time and memory per sheet, measured (2026-10-27, `realplan/rasterStage.eval.ts`)

Baker EOC, the first 50 pages, every page read as if it were a scan, at 200
dpi with Tesseract, one page after another in ONE Node process on this Mac
(M-series). Raw rows in `shots/scanned-stage/`.

| | |
| --- | --- |
| per sheet, median / mean | 8.8 s / 12.6 s |
| per sheet, p90 / worst | 33 s / 45 s (A511 and A521 detail sheets, dense small text — Tesseract 42 s) |
| of which, median | render 0.3 s · lines 0.7 s · OCR 7.7 s |
| printed scale read | 26 of 50 (the rest are covers, schedules and details with no caption) |
| JS heap, peak | 180 MB |
| resident memory | 381 MB after the first sheet · 846 MB median · **2,027 MB peak** by the 50th, in one long-lived process |

**What fits the server and what does not.** The runner does one sheet per
advance, and the pdf, the canvas and the Tesseract worker are created and
destroyed inside that one task, so the WORKING SET per sheet is the first
row — about 400 MB — not the last. The 2 GB is native memory the process
keeps after fifty sheets (the JS heap never passes 180 MB), which is a
long-lived-instance problem: Fluid compute reuses an instance across
invocations, so a hot instance that has read many scans holds the high-water
mark. Three things keep it inside a 1 GB function, in order of payoff:

1. **No full-page RGBA canvas for OCR.** `grayToCanvas` copies the 8-bit page
   into a 32-bit canvas (138 MB at 200 dpi ARCH D) only so tiles can be cut
   from it; cutting tiles straight from the grey buffer into small canvases
   removes that copy. The render's own canvas is unavoidable and is released
   after the grey is taken.
2. **Cap OCR by region, not by page.** Lines cost 0.7 s; Tesseract is 7.7 s
   median and 42 s on a dense detail sheet. The finder needs the scale
   caption, the view titles and the lettering near the drawing; a first pass
   on the bottom band and the title block gives the sheet number and the
   scale in a second, and a sheet whose number says schedule, detail or
   cover needs no second pass at all. That turns the worst case into the
   cheap case.
3. **The per-advance budget.** 45 s is longer than the runner's slice; the
   claim lease must outlast the slowest sheet or the task is reclaimed
   mid-OCR. Set the RASTER task lease to 120 s, or run OCR as item 2 and
   the question goes away.

None of the three is built here; the numbers are what decides them, and
the first real scanned set may change the order.
