### Scanned sheets read as lines and text for the wall finder — behind a switch that is OFF

A scanned sheet is a picture of a drawing: no path operators for
`sheetStrokes`, no text layer, so Find the walls had nothing to pair. The
research branch measured a raster line pass in front of the same finder at
73–76% of the vector finder's footage on the training keys, on a stack a
Linux server can run (pdf.js with its Node canvas, tesseract.js — nothing
new installed). This is that pass, productized.

**Ingest marks the scans.** The page inventory, for a page with NO text
layer, counts the content stream's path and image operators onto the
`PlanSheetText` row it already writes. `isScannedSheet` reads the verdict
off those at read time — no text, no paths, an image — and a row from before
the counts goes by its text layer, as the viewer always did. Derived, never
stored as a flag.

**A background stage reads them.** `RASTER`, a stage of the ingest runner:
one task per scanned page, the atomic claim, the browser pump. Per page:
render at 200 dpi (the bench's sweet spot), lines by the ink pass and the
contour fill pass, deskew from the long lines, Tesseract on tiles for the
words, the printed scale out of those words by the same reader a vector
sheet gets — `rasterizeSheet` — stored on `PlanSheetRaster` in points, where
`detectWallsForCalibration` and the viewer's Find the walls read it instead
of the file's strokes. The finder is the same finder; so is the review.

**The estimator sees it.** A sheet the stage has read carries "Scanned sheet:
the lines were read from an image, not from the drawing. Check each group
against the sheet more carefully than usual." The OCR'd scale caption lands
in the calibration prefill where the inventory has none; when OCR could not
read one, nothing changes — the app's own set-the-scale prompt is what the
sheet shows. A panel on the takeoff says how many sheets are scans and reads
the unread ones in one press.

Behind `Company.scannedPlansOn`, OFF, with a settings switch the owner
flips. Additive migration: two nullable counts, one table, one enum value,
one boolean. No finder file changed. Per-sheet time and memory, measured on
50 pages of a training set as if every page were a scan, are in
`lib/takeoff/NOTES-scanned.md`.
