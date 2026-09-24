### The browser suite runs in CI now, and half of it is red on purpose (Cyrus)
`cyrus/e2e-in-ci`

`pnpm test:e2e` exists because on 2026-09-21 all four CI checks and 5,800
unit tests were green while creating one invoice made every authenticated
page in the product render an error boundary. CLAUDE.md calls it "the floor
under" the click-list. **Nothing ran it.** Not `ci.yml`, not
`preflight.sh`, not any script CI invokes — so for three days the floor was
a command somebody had to remember.

Worse than nothing: three files on `main` — `e2e/run.mjs`'s header,
`playwright.public.config.ts`'s header and
`changelog.d/cyrus-e2e-mobile-ci.md` — told the reader that
`.github/workflows/e2e.yml` runs it. **No workflow by that name has ever
existed in this repository.** #430 and #446 both wrote it, both had the push
rejected for want of the `workflow` OAuth scope, and both left the job as a
diff in the PR body. Every one of those sentences was written in good faith
by an agent that had the file sitting untracked in its worktree. All three
are corrected here, and the jobs live in `ci.yml` rather than a new file —
a second workflow is a second place to look, and this repo has now paid
twice for a CI job that lived in a PR description.

**Two jobs, and the split is the point.**

`e2e-public` needs no credentials at all and runs on every PR today: every
page a person can reach without signing in, at 320, 375 and a 1280 control,
against a Postgres service container.

`e2e` is the pilot journey and every other signed-in screen. Signing in
needs a Clerk DEVELOPMENT instance, because there is no application-code
auth bypass in this suite and there is not going to be one. So it needs two
repository secrets — `E2E_CLERK_PUBLISHABLE_KEY` and
`E2E_CLERK_SECRET_KEY`, the `striking-jaybird` instance's `pk_test_`/
`sk_test_` keys — and **until they exist that job is RED, on its first step,
in five seconds, naming both of them.** It does not skip and it is not
`continue-on-error`. A green check for a suite that signed nobody in is the
vacuous green this entire directory exists to end, and `migrate.yml` set the
house style years of scars ago: fail loudly on a missing secret rather than
quietly do nothing. A `_live_` key is refused there and twice more
downstream.

**So read this before reading a green run: nothing behind sign-in is
checked in a browser by CI until those two secrets are added.** Whatever
colour the run is.

**Both jobs call the same one command a human calls** — `pnpm test:e2e` and
`pnpm test:e2e:public`, which is `e2e/run.mjs` — rather than
re-implementing its six steps in YAML. Two reasons. What CI proves is then
reproducible by typing one thing, and the runner's own guards come along:
it asserts its database URL through `scratchProblem()`, it refuses a
production Clerk key, and it deletes `DATABASE_URL`, `DIRECT_URL`,
`BLOB_READ_WRITE_TOKEN` and `ANTHROPIC_API_KEY` out of the environment it
hands its children. The database is a `postgres:16` service container named
`prova_e2e_test`, the same shape `dbtest` already uses, reached through the
runner's documented `E2E_DATABASE_URL` — which goes through that same
guard, so it still has to be loopback and still has to end in `_test`.

**`e2e/collected.mjs` is the new file, and it is there so the green means
something.** `verdicts.mjs` (from #446) checks the verdicts a run returned
against the number of tests collected, because a run that collected nothing,
a run whose tests were all skipped and a run that passed are the same exit
code. That only works if the collected number comes from somewhere that
cannot drift with the run, and a literal in `ci.yml` drifts the day somebody
adds a spec — stale upward it never complains, stale downward the job goes
red for no defect. So the number comes from `playwright test --list
--reporter=json` against the same config, and this file counts it.

It is itself a deriving check, so it has the two failure modes CLAUDE.md
names: the wrong answer, and an empty question. It refuses to print zero (a
config that collects nothing is broken, not empty), it refuses a listing
carrying errors, and it cross-checks its walk of the report's nesting
against the report's own `stats` totals — two derivations from one file, so
a shape change under us says so instead of quietly returning a smaller
number that every downstream assertion then passes. Mutation-tested four
ways: suites emptied (walked 0 vs stats 24 — "two derivations disagree"),
both zeroed ("collects no tests"), an `errors` array ("a listing that failed
is not a count of anything"), and a missing file. All four red with the
message named.

**What is verified and what is not, precisely.** Typecheck, lint, 7,147 unit
tests in 451 files and a full production build are green on this branch.
`--list` collects 24 tests for the public config and 36 for the signed-in
one, which is what the counts in CI are checked against. **No browser ran
here**: an agent container cannot download Chromium (`cdn.playwright.dev` is
denied by the egress proxy) and cannot reach Clerk's FAPI, and embedded
Postgres would not start either — `node` gets `EACCES` spawning `initdb`
from this filesystem, though the binary runs fine from a shell. So whether
the journey PASSES is a question only the CI run on this PR can answer, and
the answer is in the `e2e-public` job's log plus the `e2e` job's named
refusal.

**Cost and timeouts.** `e2e-public` 30 minutes, `e2e` 45 — a hung journey
must fail rather than burn six hours of runner time on the default. The
Chromium build is cached on `~/.cache/ms-playwright` keyed by the lockfile,
and `playwright install --with-deps chromium` still runs: the cache saves
the 170 MB download, the command repairs a partial cache, and the apt
libraries are not cacheable anyway. **No `concurrency:` cancelling
superseded runs**, deliberately, though it would save minutes: a cancelled
run reads exactly like a run that never started, and #59's scar is a whole
section of CLAUDE.md about an absent check being misread as a passing one.
