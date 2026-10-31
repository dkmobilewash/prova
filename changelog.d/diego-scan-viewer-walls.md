### Find the walls on a scanned sheet works in the workspace, and a scan rastered before the corner read can get its number

- `TakeoffWorkspace` passed the viewer `scannedPages` and not `rasterByPage`,
  so in the workspace Find the walls on a scanned sheet read the PDF, found
  no strokes and offered nothing while the sheet's raster row held thousands
  of lines (Evergreen p24: 4,610 lines, 216 walls through the same finder in
  Node). The prop is passed; `scannedViewerHosts.test.ts` requires every
  host that passes one to pass the other.
- `backfill-scanned-page-rows.ts --read-sheet-numbers`: a raster row with no
  sheet number (rastered before #845's corner read) is read again for its
  number only — `rasterizeSheet(..., { numberOnly })`, strips and corner
  cell, Tesseract, no model — and the row and an unlabelled page row get
  it; a labelled page keeps its label. `backfillScannedSheetNumbers`, in
  the dbtest.
