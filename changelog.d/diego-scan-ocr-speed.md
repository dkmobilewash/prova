### OCR was the whole cost of a scanned page; three things it was doing for nothing (Diego)
`diego/scan-ocr-speed`

With the render down to half a second (`diego/scan-decode`), Tesseract was
the rest of a scanned page: one worker reading every tile of the grey in
turn, blank margins included, created fresh for every sheet. Three changes,
none of which may move a word — the walls read the words — so each is built
to keep the output byte-identical by construction:

- **Blank tiles are never sent.** `tilePlan.mjs` walks the tiles as before
  and keeps every key, but a tile with fewer than 40 dark pixels is not
  read; Tesseract on it returned nothing after a quarter of a second, and a
  plan sheet's margins are a third of its tiles. Tested in isolation.
- **Two Tesseract lanes read the tiles at once** (`RASTER_OCR_LANES`, 2 by
  default), with results folded in tile order afterwards so the dedupe sees
  them exactly as one worker would.
- **A closed sheet thread waits warm.** `close()` releases the thread to a
  two-deep idle pool with its document destroyed and its lanes kept;
  `start()` takes an idle one first. `RASTER_WORKER_POOL=0` terminates on
  close as before. An idle thread is unref'd and never keeps a process alive.

Evergreen, 106 pages, on a throwaway tree of `main` + `scan-scale` +
`scan-decode` + `scan-sheet-numbers`, each arm alone on the machine:

| per page | before | after |
| --- | --- | --- |
| whole page, median / p90 / max | 10.2 s / 28.2 s / 68.8 s | **5.6 s** / 13.0 s / 26.1 s |
| OCR, median / p90 | 8.7 s / 24.5 s | 4.3 s / 8.5 s |
| RSS mid-sheet, peak | 2.69 GB | 2.15 GB |
| RSS after a sheet, median / peak | 336 MB / 1.26 GB | 1.12 GB / 1.82 GB — the warm lanes |
| scale read / sheet number read | 37 / 82 | 37 / 82, **identical on every page** |
| words / lines, total | 23,241 / 416,923 | 23,241 / 416,923, identical per page |
| walls / ft on the 36 scale-read pages | 36,550 ft in 2,940 runs | **identical on every page** |

The target was 5 s a page and this lands at 5.6. What is left, in pay
order: a third lane (OCR is 4.3 s of the 5.6 and scales with lanes; the
machine measured has ten cores, a Fluid function fewer), the sheet-number
cell read (1.5 s inside that OCR figure, which could run on a lane while
the rest of the page is read), and the lines step (0.75 s) moved into the
worker, which needs a build step for the plain-JS thread. The warm pool
costs 0.8 GB resident between sheets; `RASTER_WORKER_POOL=0` gives it back.

Label sweep over every labelled vector sheet, `main` vs this branch: all 46
byte-identical (`shots/ocr-speed/sweep/`).

Not built: the lines step inside the worker. It is TypeScript the plain-JS
worker cannot import without a build step, and it is 0.8 s a page.
