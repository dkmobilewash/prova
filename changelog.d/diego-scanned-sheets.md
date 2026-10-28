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

**Second round — the server budget and the whole-sheet fallback.** The
render draws in bands into one reused canvas, OCR cuts its tiles from the
grey into one reused tile canvas, the title block and bottom band are read
first and a sheet whose own title says schedule, cover or elevation stops
there, one Tesseract worker per sheet: on 50 Baker pages read as scans,
8.8 → 6.1 s median and 33 → 12.5 s p90, high-water memory 2.0 → 1.2 GB in
one long-lived process (a single sheet's working set is 450–760 MB; the
rest is what a process keeps, and one sheet per worker is the next step,
not built). Lines unchanged within 0.14% a page; the stage's own step
scores 77% of the key footage on the 26 training sheets against the
bench's 76%.

`wholeSheetFallback` in `detectForSheet`: drawings found, none measured,
none set aside for a named reason → the whole sheet is measured and the
caution says to check it. Baker A201 stays at zero; the 31-sheet vector
sweep is byte-identical before and after; and on the four scanned cases it
was written for it does not fire, because their zeros turned out to have
names — `NOTES-scanned.md` §8 has the table and the one rule change that
would reach Bunkie A100, left for a decision.

**Third round — one worker per sheet, and captions a scan can be trusted
on.** The render and OCR of a sheet run in a `worker_threads` Worker closed
with the sheet, so what a sheet costs leaves the process with it; the
memory figures, sampled after a forced collection, are in
`NOTES-scanned.md` §7. On a SCANNED sheet, detection believes a caption
only when OCR scored its line at 70 or better and every word is a word a
caption uses; fewer than two such captions and the sheet is one drawing.
That is where the scanned zeros came from — OCR noise read as "elevations"
or "notes" and set aside for reasons that sounded real: Bunkie A100 at
300 dpi 0 → 774 of 470 key ft, Murray A101 at 150 dpi 126 → 2,383 of
1,037; rasterized Baker A201 stays at 0; the vector sweep's detection
columns are identical on all 36 sheets (the keys moved under it, not the
code). The Bunkie-style widening is written down and not built (§10); the
e2e list for the PR is §11.
