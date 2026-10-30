### A scanned sheet gets its page row, and its OCR-read scale, when RASTER reads it

- No scanned sheet could be opened: the workspace lists `TakeoffPlanPage`
  rows, which only a saved scale creates, and a scanned set has none, so
  every `?page=N` fell to the first-sheet fallback with nothing to fall back
  to (Evergreen, 106 pages raster-ready, unreachable). `rasterWork` now
  writes the page row after the raster row — labelled with the OCR-read
  sheet number — and, where OCR read a printed scale, the scale reading and
  a calibration from `scaleFromPrinted` with `scanned: true`, never a typed
  number; otherwise the sheet opens at "set the scale". A page with a
  calibration is left alone. `scannedPageRow.dbtest.ts`, through the runner.
- Pages rastered before that step existed get their rows from
  `backfillScannedPageRows` (`scripts/backfill-scanned-page-rows.ts`, dry run
  unless `--write`): one `scannedPageRow` per raster row with no page row, by
  the same rules; a page that exists is not touched. Idempotent; in the same
  dbtest.
