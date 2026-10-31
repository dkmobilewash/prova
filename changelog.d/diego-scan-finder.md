### A scanned set no longer ships every sheet's lines to the browser, and scans stop offering the title block as walls

The takeoff page carried every page's raster read, 31 MB of lines on a 106-sheet set, which is the likely cause of the blank tab reported on Evergreen. The viewer now fetches one page's read when it needs it, from a route with the same company and capability check as the plan file.

On scans, runs in the title-block strip and one wall read twice are set aside, runs that are a word's letter strokes are set aside, and one misread sheet number no longer stops OCR. Held out on Evergreen: recall unchanged at 94.1%, junk 18 to 16 per 100 key ft.

The check for the trap: raster-line changes that lifted synthetic scans from 47% to 64% recall cut the real scan from 94% to 80%. They are not in this PR. Score any raster change on a real scan before believing a synthetic one.

The viewer also releases each page after drawing it. JS heap after walking a set fell from 361 MB to 82 MB on Evergreen. The blank tab was not reproduced, so re-test it rather than assume it is gone.
