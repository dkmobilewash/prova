### A configured model file the deployment did not ship is named out loud, once, greppably (Diego)
`diego/model-census`

Found live on 2026-11-24: production's `TAKEOFF_WALL_MODEL` named a file the deployed
function did not carry, so the pairwise wall classifier ran silently OFF — while the
three run/reno model files beside it in `outputFileTracingIncludes` shipped fine. The
only symptom was one once-per-process stderr line on a page production rarely loads;
over seven days of runtime errors it appeared exactly twice, both from the agent
checking for it. A missing model looks exactly like a model switched off, which is the
sentence the env var's own comment had already written.

Three pieces, none of which can see a Vercel bundle, each pinning what source can carry:

- **`modelFileCensus` + one `[model-census]` stderr line** at the first `serverHeldModels`
  call per process, naming every configured-but-missing model file together (unset stays
  a choice, not a failure). Grep target for the deploy-watch and the Thursday product check.
- **`modelCensus.test.ts`**: every committed `apps/web/models/*.json` must be named in
  `outputFileTracingIncludes` (mutation-tested: deleting an include line goes red); both
  documented path spellings land on the committed file; `MODEL_FILE_ENVS` is derived from
  the owning modules' constants and a source scan fails the build on any `TAKEOFF_*_MODEL`
  literal the census does not cover — the "second list" guard.
- **`door-model.json` was committed and never traced** — the test's first run found it, so
  the include lands here before anyone sets `TAKEOFF_DOOR_MODEL` and rediscovers all of this.

What this deliberately does not claim: why the tracer shipped three siblings and dropped
`wall-model.json` on dpl_9hfCmf5o/dpl_AEvWJEp2 is still unexplained; no repo test can read
a lambda's filesystem. The census makes the next occurrence one grep instead of an afternoon.
