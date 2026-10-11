### CI stops pulling a Postgres image, because Docker Hub stopped letting it (Diego)

`diego/ci-no-docker`

On 2026-10-09 three of the four CI jobs failed on the same line:

```
toomanyrequests: You have reached your unauthenticated pull rate limit
```

`dbtest`, `e2e` and `e2e-public` each started a `postgres:16` **service
container**, and the pull hit Docker Hub's anonymous cap. A re-run hit the same
wall. The cap is on GitHub's shared runner IPs, not on anything this repo
controls, so it blocked every PR and waiting it out was not a plan. `ci` —
test, lint, typecheck, build — passed throughout, which is how a red run that
has nothing to do with the diff looks.

#### The fix is to stop needing the registry, not to authenticate to it

The other option was `docker/login-action` plus a Docker Hub account and two
repository secrets, to keep pulling an image we do not need. **`embedded-postgres`
has been a dependency of this workspace all along**, and `e2e/run.mjs` already
boots its own throwaway Postgres with it — that is what every local
`pnpm test:e2e` has always done. Providing a database through
`E2E_DATABASE_URL` was the optional path, and CI was taking it.

So:

| job | before | after |
| --- | --- | --- |
| `e2e`, `e2e-public` | service container + `E2E_DATABASE_URL` | neither — `run.mjs` creates its own, as it does locally |
| `dbtest` | service container + a job-level `DATABASE_URL` | `apps/web/e2e/scratch-postgres.mjs`, which boots one, runs the migrations and the suite inside it, and takes it down |

No job pulls an image now. Nothing about either suite changes: the runner still
applies every committed migration to the database it creates, and
`scratchProblem()` still refuses a host that is not loopback and a name that
does not end `_test`/`_dbtest` — the guard added after a real Neon endpoint was
reset on 2026-09-18, which has deliberately no env-var escape hatch.

`DATABASE_URL`/`DIRECT_URL` stay set on the two e2e jobs and are **not a
database anybody connects to**: `playwright.config.ts` asserts both through that
same guard at config load, and the `--list` step runs before the runner has
created anything. The runner overrides both for every process it spawns.

#### What was verified, and what was not

- **The public suite was run locally on exactly the new path** — `E2E_DATABASE_URL`
  unset, no container: the runner booted its own Postgres, migrated it, built the
  app, served it, **24 passed**, and the database was stopped and deleted.
- **The db suite was run locally through the new script**: migrations applied,
  then **692 passed**.
- `scratch-postgres.mjs` was checked for the failure direction too, which is the
  one that matters: a failing command exits with its own code (3 in, 3 out),
  and a later command does not run. A harness that swallowed a failure would
  turn this job green on a broken suite, which is the vacuous green the whole
  `e2e` directory exists to end.
- The workflow was parsed rather than eyeballed: four jobs, `services` empty on
  all four, `E2E_DATABASE_URL` unset on all four.
- **NOT re-run locally: the signed-in journey.** Its database handling is the
  same code path the public run just proved, and running it locally straight
  before a CI run risks rate-limiting the development Clerk instance — a 429
  there reads as broken pages and would send the next person chasing a phantom.
  CI is where that one is proved.
