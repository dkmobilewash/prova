### A scan is one image, and pdf.js had already decoded it — the canvas was the whole cost (Diego)
`diego/scan-decode`

On a real scan (8102 Evergreen, 106 pages of 14,600 x 9,800 px 1-bit CCITT at
400 dpi) the raster stage spent 5.4 s a page and 2–4 GB of RSS in `render`,
because pdf.js expands the decoded bits to a full-resolution RGBA picture —
572 MB a copy — before drawing it scaled into the band canvas. The packed
1-bit rows it decodes first are 18 MB and sit on `page.objs` the moment the
operator list exists.

`rasterWorker.mjs` now reads them directly when a page is exactly one image
over the whole page with nothing else drawn — no rotation, no stroke, no text
shown, 1 bit per pixel — and box-averages the bits into the 200-dpi grey in
the canvas's own 256ths with white pinned to 255, which makes the grey
BYTE-IDENTICAL to the render it replaces (measured on Evergreen p24: 0 of 35.8
million pixels differ; plain rounding differed on 0.4% by one level, and that
one level moved OCR by three words and the walls by 24 ft). Anything else, a
vector sheet included, falls back to the banded render unchanged.

Evergreen, 106 pages, same machine, same day: render 5.6 s → **0.53 s** a page
(median; p90 11.1 s → 0.8 s), the page 16.0 s → 9.9 s with OCR now the whole
cost; RSS after render 2.2 GB → 0.93 GB median, mid-sheet peak 4.0 GB →
**2.1 GB**, left after a sheet 817 MB → 252 MB. The six JPEG pages of the set
fall back to the canvas and are the render maximum (15.8 s). Walls and feet on all 36 scale-read pages
are identical to the canvas run. The label sweep over every labelled vector
sheet is byte-identical before and after. Four unit tests pin the direct path
(the bits, the half-size averages) and both fallbacks (extra ink, an image
smaller than the page).
