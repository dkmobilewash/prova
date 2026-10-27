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

## 3. Results

(filled in from `shots/scanned/full-run.log` and `scanned-arms.json`)

## 4. Cost and speed

(filled in from the run's per-step timings)

## 5. Productising

(see the report)
