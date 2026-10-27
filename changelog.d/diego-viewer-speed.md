### The first sheet of a big set stops waiting behind the download of the whole set

`diego/viewer-speed`

Production took 10–15 s to show the first sheet of a large plan set. Measured on
Topeka Senior Villas (137 pages, 114 MB) with `apps/web/scripts/viewer-bench.mts`
— a real Chromium, the app's own pdf.js build and `canvasPlan`, a server that
paces each request like a function hop — the cause is pdf.js's default
transport: it opens one streaming request for the entire file and keeps it
running while the dozen small range reads the first page needs share the line.
At 500 ms per request the first page drew at **12.1 s** with 77 MB already
transferred; at 250 ms, 6.9 s.

`PLAN_PDF_TRANSPORT` (`lib/takeoff/planPdfTransport.ts`) turns off BOTH
background fetches and reads in 1 MB chunks: **6.9 s at 500 ms, 3.8 s at 250 ms**,
13 requests, 15 MB, and nothing further once the page is drawn. `disableAutoFetch`
alone — the setting that was suggested — changes nothing (12.2 s), because the
full-file stream is a separate mechanism; the table in the module says so.
Applied at every open of `/api/takeoff/plan/…`: the viewer, the sheet tree's
thumbnails (which opened a second document and streamed the set a second time,
in parallel) and the legend review. `planPdfTransport.test.ts` finds every such
open and fails if one drops the spread; mutation-tested.

**What the same harness did NOT find.** Chrome reported ~10 s to redraw after
every pan or zoom on Topeka p74 (95,455 drawing ops). On this Mac, headed and
headless: a zoom re-render is 50–370 ms (the 370 is the first draw of a page,
which includes the operator list crossing from the worker; later zooms are
50–135 ms), a scroll settles in 16–33 ms with the 530-line overlay, and the real
`TakeoffPlanViewer` re-renders with 1,562 candidates in 20 ms. Nothing in the
viewer's drawing reproduces the report, so nothing in it was changed on a guess.
Timings in `~/Claude Folder/takeoff/shots/viewer-speed/`, outside git.
