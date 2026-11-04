### Typecheck gets the same 8 GB as the build, so CI stops failing at random on memory
`diego/typecheck-memory`

`tsc` ran out of heap on the CI runner's default Node limit (exit 134, FatalProcessOutOfMemory) four times on `main` in two days, each time passing when re-run. A red check that means "the runner was unlucky" teaches everyone to re-run instead of read. The Build step already sets `NODE_OPTIONS=--max-old-space-size=8192` for the same reason; Typecheck now does too.

Check: the `ci` job's Typecheck step shows `NODE_OPTIONS` in its environment, and no exit-134 typecheck failure recurs.
