### Scanned plans: a raster line pass in front of the vector wall finder, measured on the training keys — research, no product UI

A scanned (image-only) sheet gives the takeoff nothing today: `sheetStrokes`
reads path operators and a bitmap has none. This branch asks how far the
EXISTING finder gets if the lines are read off the bitmap instead, and
answers with numbers rather than a plan.

`lib/takeoff/raster/`: `rasterLines` binarises a page and walks every row
and column for runs of ink, merging runs that sit on each other into bands —
one segment per band, corner to corner so a scanner's tilt survives; a thick
filled band becomes its two faces, the pair a drawn wall would have made. A
second, looser pass on a blurred copy picks up light-grey fills (existing
walls, poché) without reading a scan's speckle as line work. The segments go
to the same `detectForSheet` as a vector sheet, in points. `estimateSkewDegrees`
reads the tilt off the long lines and the page is turned back before the
lines are read again. `rasterDegrade` makes a clean render scan-like — skew,
speckle, blur — deterministically.

`realplan/scanned.eval.ts` rasterises every TRAINING sheet with an answer key
(26 sheets, 26,900 key ft; held-out names refused) at 150, 200 and 300 dpi,
clean and scan-like, reads the printed scale with OCR, scores every arm with
`scoreSheet` beside the vector finder on the same sheet, and times each step.
`scanTool.swift` does the render and the OCR with Apple's PDFKit and Vision —
the research arm; the report says what production would run instead.

No finder file changed. The findings and the production plan are in
`lib/takeoff/NOTES-scanned.md`; the overlays and per-arm JSON are outside git.
