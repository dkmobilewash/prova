### The learned wall models load in production: their path is resolved when the function runs, not when it was built

Production's `[walls-model] unreadable` named `/vercel/path0/apps/web/models/wall-model.json`. That is
the BUILD directory. Webpack replaces `import.meta.url` in the server bundle with the build machine's
file URL (the local bundle carries `file:///Users/…/wallModelFile.ts` literally), and
`resolveModelPath` (#860, 2026-10-29) derived every relative model path from it alone. The file was
traced into the function (179 of 179 entries in a local build); the resolver looked where only the
build had it. All four learned models (pairwise, run, R, R-ALL) go through that one resolver, so none
of them has loaded in production since it was configured. The run/reno files were never shown to load:
the failing page reads only the pairwise model, so their silence in the error log proved nothing.

This also corrects #1248's own entry (`changelog.d/diego-model-census.md`) and the census comments,
which said the deployment did not ship `wall-model.json` while its siblings shipped fine. Both claims
were false. The `[model-census]` line now says it "cannot find" the file rather than that the file
was not shipped.

`resolveModelPath` now tries the working directory first (the repo root on Vercel, apps/web locally),
then apps/web under it, the repo root above it, and the baked directory last, for a laptop.

Checks:
- `modelCensus.test.ts` reproduces the outage: every committed model must resolve, from both env
  spellings and both working directories, when the baked build directory does not exist. The #860
  resolver and two partial fixes each fail it.
- `function-size-budget.mjs` (CI, after the build) fails when a model named in
  `outputFileTracingIncludes` is missing from any entry's trace. That was NOT this outage. A stale build
  from before `door-model.json` was listed fails it with 155 entries.

`rasterWorkerPath()` derives its path from `import.meta.url` the same way. It is left for its own
change.
