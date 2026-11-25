### The scanned-sheet worker ships with the packages it imports, so scanned reading can run in production

**What happened in production.** #1252 made the worker's path right. Its proof (2026-11-24, 22:50:59Z and 22:51:31Z)
then showed the thread dying on its first import: `ERR_MODULE_NOT_FOUND Cannot find package 'pdfjs-dist' imported from
/var/task/apps/web/lib/takeoff/raster/rasterWorker.mjs`.
- The worker is copied into every function as a file (`outputFileTracingIncludes`), so nothing traced what it imports.
- In the local build, 0 of 179 functions held pdfjs-dist, @napi-rs/canvas, tesseract.js or tesseract.js-core.
- Scanned reading had never run in production.

**What changes.**
- next.config.mjs includes the worker's packages **through pnpm's flat store** (`node_modules/.pnpm/node_modules`):
  pdf.js's legacy build and its worker, @napi-rs/canvas and its platform binary, tesseract.js's sources, its LSTM
  cores and their dependencies, and `tilePlan.mjs`.
  - Why the store: an include glob copies files at the path it matched, and never copies pnpm's directory symlinks.
    From the store they arrive as one flat directory, where each package's own `require` finds its siblings. The same
    files included through `apps/web/node_modules` would leave pdf.js unable to find the canvas.
- The worker resolves its packages from that same directory (`lib/takeoff/raster/runtimeStore.mjs`).
- About 55 MB per function (largest function 0.17 GB against the 4.5 GB budget).
- Not changed: Tesseract still downloads `eng.traineddata` from its CDN at run time, into the OS temp directory.

**Checks.**
- `scripts/raster-worker-trace-check.mjs` runs after every build, called from the budget step CI already runs.
  - It rebuilds the scanned-sheet route's function from its `.nft.json` (files copied, symlinks recreated, nothing
    else) and runs the real worker inside it: a render, the tesseract.js import, and its thread's core load.
  - A control runs the same probe in the repo first.
  - On main's build: FAIL with the production line, `Cannot find package 'pdfjs-dist'`.
  - With this change: the worker renders, and Tesseract's core loads.
