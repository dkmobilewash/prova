### Three guards that were green while the thing they guard was broken (Cyrus)
`cyrus/guard-audit`

An audit of the 108 tests in this repo that DERIVE the set they reason
about — every census, every source scan, every directory walk. Each finding
was proved by mutation: break the defect the guard exists to catch, run the
guard, record the colour. A guard that caught it is not a finding and is
listed as verified rather than touched.

Three were lying. All three are fixed here, and each fix was re-mutated to
prove it now goes red.

**1. A counter bumped outside a transaction, in an API route, was invisible.**
`counterCensus.test.ts` is the whole #224 guard — a counter incremented on
the bare `prisma` client rather than on `tx` is `max(n)+1` again, so two
concurrent submits read the same number and the second collides on the
unique index, throwing a message production redacts. Its scan reads
`sourceFiles(libDir)`, which is `apps/web/lib`. Two live counter bumps sit
outside it: `app/api/v1/jobs/[id]/incidents/route.ts` and
`…/material-orders/route.ts`, which are how the phone files an OSHA case and
a material order. Changing `tx.safetyCaseCounter.upsert` to
`prisma.safetyCaseCounter.upsert` there left all thirteen assertions green.

The file's own header already records this scope — "a third route that
forgot would have been just as invisible" — and the widening that followed
covered the INSERT question only, not the transaction one. A new repo-wide
block now asks the transaction question over everything under `apps/`, taken
from the git-derived file set the file already builds, with the two routes
pinned by name and the bump count asserted against a literal. Scope is "is
this request-scoped" rather than a path list, so `seed-demo.mjs` bumping
outside a transaction stays legitimate rather than exempted.

**2. `plumbing.test.ts` generated one test per workflow script and none when
it parsed none.** It exists so a workflow cannot ship calling a script that
is not in the repo — which happened, with `seed-demo.yml`. The check is
`it.each(invocations)`, and `invocations` had no size assertion: with the
parser's regex narrowed so it matched nothing, a workflow genuinely pointing
at a deleted script went green and the file's test count dropped 42 → 33
with no failure anywhere. The `files.length > 2` guard above it was never the
fragile half. The invocation count is now asserted against a second,
deliberately dumber line scan over the same text.

**3. A `.test.tsx` anywhere in `apps/web` was collected by nothing.**
`vitest.config.mts` included `**/*.test.ts` and not `.tsx`. A
deliberately-failing `lib/ZZ_orphan_probe.test.tsx` sat in the tree while
`pnpm test` reported 454 files, 7202 tests, all green; asked to run that one
file, vitest printed `No test files found` and its own single-extension
include underneath. Nothing was orphaned yet only because no `.test.tsx`
existed here — and `.tsx` is the natural extension for a component test and
the one `apps/mobile/screens` already uses for exactly that. This is the
161-orphaned-`.dbtest.ts` shape in CLAUDE.md, loaded and waiting for the
first person to write a rendered component test.

Include widened, and `lib/testRunnerCensus.test.ts` added so it cannot come
back: it derives every test file from `git ls-files`, every workspace package
from `pnpm-workspace.yaml`, and every include glob by IMPORTING the config
each package script names — the same object vitest reads, not a second copy
that can drift — then fails when any test file is matched by no runner. It
catches the probe by name, and it would have caught the 161. It also fires
the day anyone adds a test to `packages/ui`, `packages/db` or
`packages/integrations`, none of which has a `test` script at all.

**Two documentation corrections, both mechanically falsified.** CLAUDE.md's
sequence-counter roll-call named nine counters and the schema declares
eleven — `EstimateVersionCounter` and `Wh347PayrollCounter` were missing, and
the census holds a floor (`>= 9`) rather than an equality on purpose, so
nothing could notice. And `components/MoneyRail.tsx` said it was "deliberately
NOT wired into any layout or nav yet — the open nav PRs (#249) own those
files". Those landed; `Sidebar.tsx` renders the Money Rail itself and nothing
imports `MoneyRail`. A header telling the next reader a dead file is pending
is how an edit gets made in the wrong copy.

Everything else is in the PR body: the guards verified honest by mutation
(nine of them, including the two whose scars CLAUDE.md records), the dead
exports and dead columns found on the way, and the two suites this container
could not execute — the db suite and the E2E journey — which are listed as
unchecked rather than passed, because that distinction is the whole subject
of the audit.
