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

## 3. Results (26 training sheets, 26,901 key ft; full table and per-sheet rows in `shots/scanned/REPORT.md`)

| arm | real ft (found − junk) | real % | missing ft | junk ft | scale by OCR | median s |
| --- | --- | --- | --- | --- | --- | --- |
| vector finder | 23,793 | 88% | 4,392 | 13,014 | — | 2.3 |
| 150 dpi clean | 18,063 | 67% | 9,962 | 28,695 | 22/26 | 2.4 |
| 200 dpi clean | 19,076 | 71% | 8,788 | 27,758 | 22/26 | 3.0 |
| 300 dpi clean | 18,494 | 69% | 9,286 | 26,203 | 20/26 | 4.7 |
| 150 dpi scan-like | 18,415 | 68% | 9,679 | 34,383 | 11/26 | 3.0 |
| 300 dpi scan-like | 17,074 | 63% | 10,494 | 22,336 | 16/26 | 6.4 |

Three quarters of the vector finder's recall, twice its junk; nothing gained
above 200 dpi. The losses concentrate in grey-filled existing walls (Baker
A100 99 → 36), heavily shaded sheets (Alden A103, 4,899 ft of junk) and the
view-detection branch zeroing a sheet when OCR noise reads as captions
(Joplin, Murray at 150; NG McAllen, Bunkie at 300). Diagonal key footage is
0.2%.

## 4. Cost and speed

Per sheet on this Mac: 2.4 s at 150 dpi (render 0.1, lines 0.3, OCR 1.0,
detect 1.1), 4.7 s at 300. No model called. Production would render with
pdf.js + `@napi-rs/canvas` and read the scale with Tesseract or one small
vision call; 3–6 s of CPU inside the ingest runner's 45 s per-sheet budget.

## 5. Productising

Route sheets with `pathOperators === 0` to the raster pass behind a company
switch; render server-side at 150 dpi; the deskew and lines as here; a
"no view kept → whole sheet" fallback in `detectForSheet` (finder lane);
OCR the scale with the existing set-the-scale prompt as the fallback; fills
by contour instead of runs (the one change that moves A100); then measure on
REAL scans of five training sheets before trusting the synthetic arm.
