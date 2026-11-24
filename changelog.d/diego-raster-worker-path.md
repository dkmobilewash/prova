### The scanned-sheet worker script is found when the function runs, not where it was built

`rasterWorkerPath()` (`lib/takeoff/raster/nodeStack.ts`) derived the worker script's path from `import.meta.url`
alone. Webpack replaces that in the server bundle with the BUILD machine's file URL, which is the bug that kept
every learned wall model unreadable in production until #1250. The path now goes through #1250's
`resolveModelPath`, which tries the working directory first and the baked directory last.

The sweep Diego asked for, cross-verified by two separate greps of main: after #1250 this was the only server
code that built a file path from `import.meta.url`. The rest are browser bundler assets (LegendCrop,
SheetPinSurface, SheetPinViewer, TakeoffPlanViewer, TakeoffSheetTree, detectOffThread, and `intake/pdf-text`,
which only client components import) or unbundled tooling (`walkthroughs/census-helpers`, `takeoff/bench/run`).

Checks, in `nodeStack.test.ts`:
- The script is found from the repo root and from apps/web when the baked build directory does not exist.
- The function's own body goes through the resolver and never reads `import.meta.url`. This half catches the
  old code, which passes the first check on a laptop.

Three mutations each fail the tests: the old code, a resolver that ignores the working directory, and a
baked-directory-only join. Proof in production is a scanned page actually reading there; a unit test is not
that proof.
