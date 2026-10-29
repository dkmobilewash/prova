### A scan is the paper plus the scanner's bed, and the sheet-size gate refused every page of it (Diego)
`diego/scan-scale`

8102 Evergreen BLDG D — the first real scanned set, 106 pages, one 400-dpi
1-bit image each — was detected as scanned on all 106 pages, rasterised on all
106, and measured on none. The printed caption `1/8" = 1'-0"` WAS read by
OCR; `scaleFromPrinted` then refused it because `standardSheetSize` allows a
page two percent off a standard sheet and a scan is 36.5 x 24.5 in: ARCH D
plus half an inch of scanner margin on each edge.

`standardSheetSize` and `scaleFromPrinted` take `{ scanned: true }`, under
which the gate is an inch each way in absolute terms, since a scanner's
margin does not scale with the paper. Only the raster stage passes it. Evergreen now reads a scale on 36 of 106
pages and offers walls on 33 of them (18,350 ft across the eleven 1/8"
floor plans), from none. A
vector sheet keeps the exact gate, and the label sweep over every labelled
vector sheet is byte-identical before and after. The scale still comes only
from the caption; nothing is hand-set. Unit test pins the Evergreen page size
refused as vector and accepted as scan.

Sheet numbers on scans are still not read (the title block's big number OCRs
as `A244 1 B` for `A241B`); what that needs is written up in
`NOTES-scanned.md` §12, with the per-step cost of a real scan and the four
changes that would bring a page under 5 s and 1.5 GB. None of those is built
here.
