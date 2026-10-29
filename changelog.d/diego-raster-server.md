### What actually changed, in plain English (Diego)
`diego/raster-server`

**A scanned sheet's thread is started on the real file, not a webpack
chunk — and a page that hangs is written down.** Evergreen's 106 scanned
pages finished none on the server, with attempts spent and no error
anywhere: webpack had recognised `new Worker(new URL("./rasterWorker.mjs",
import.meta.url))` as worker syntax and started the thread on a bundled
chunk that never answered, and the runner awaited it with no bound, so the
lease lapsed, the next claim cleared the error, and three rounds later
nothing was recorded. The thread's script is now a path the bundler cannot
rewrite (proved on a production build), force-included in the output
trace; the sheet worker refuses a dead thread and times out a silent one;
the runner bounds a page at lease − 5 s and records "did not finish within
N seconds at the RASTER stage"; and the job itself keeps `lastError`,
`lastErrorStage`, `lastErrorPage`, `lastErrorAt` (additive migration),
written on every failure and never cleared by a later success. The raster
stage now runs through the ingest runner in a unit test, including the
hang.
