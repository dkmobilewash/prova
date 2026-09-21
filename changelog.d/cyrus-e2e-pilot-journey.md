### A machine now clicks through the pilot journey before a person has to (Cyrus)
`cyrus/e2e-pilot-journey`

On 2026-09-21 CI was green, 5,800+ unit tests were green, dozens of census
guards were green — and typing `2,800` on the second screen of a first
job threw a redacted server error, `12,500` in an invoice amount took the
billing tab down, `0.10` retainage saved a tenth of a percent in silence,
and **creating one invoice made every authenticated page in the product
render an error boundary**, with no way back from the UI. Every one of
those was found by a human clicking, hours before real contractors were
due to log in. CLAUDE.md had already said it: *"Real bugs here have only
ever been found by loading the page and doing the thing."*

**`pnpm test:e2e` does the thing.** One command, from the repo root. It
boots a throwaway Postgres 16, applies every committed migration to it,
builds the app the way production runs it, signs a real Clerk test user in
through a real Chromium, and walks the pilot contractor's path *in order*:
sign in → the welcome questions → dashboard → a first job with a GC → an
estimate line → the executed subcontract → "Mark as contracted" →
retainage 10% → the first invoice → **every authenticated page again** →
all eight job tabs → dashboard and jobs list → all thirty-odd main nav
destinations. After every navigation and every action it fails if the page
shows `Application error`, `This page didn't load`, `Digest:`, the redacted
"Server Components render" sentence, or any uncaught browser exception —
**and it fails if the page rendered nothing**, because a blank page
contains no error sentence either, and this repo has paid for that vacuous
green more than once (`apps/web/e2e/lib/health.ts`). Step 7 of that spine
is the day's catastrophe, and "7b" is the sentence it would have printed.

**The known-bad inputs are their own cases** (`known-bad-inputs.spec.ts`),
written to the correct behaviour — save it, or refuse it in a sentence a
person can act on — not to what the code did that day. **They are red on
`main` as of this entry**, by design: the fix is #414 (`cyrus/number-inputs`),
which had not merged. A red case here names a live bug; a green one means
the fix stayed fixed. The retainage case accepts three shapes because #414
chose the third: refused, read as 10%, or kept as typed with the dollars it
withholds on screen. It fails only on the silent one.

**Where it runs, and why not CI yet.** Locally, on demand. The same two
walls #364 hit stand: this laptop's `gh` token has no `workflow` scope (so
no agent can push a `.github/workflows/` change — CLAUDE.md said the scope
was there; it is not, and that bullet is corrected in this PR), and the
`E2E_CLERK_PUBLISHABLE_KEY`/`E2E_CLERK_SECRET_KEY` repository secrets do not
exist. The CI job is in the PR description as a diff, ready to apply from
an account with the scope, once Diego adds the secrets.

**It cannot touch a real database, and that is the same guard as before,
not a new one.** `scratchProblem()` from
`packages/db/scripts/connection-target.mjs` — what `vitest.db.setup.mts`
runs — is now called in *three* places: the runner asserts its own URL
through it before handing it to anything; `playwright.config.ts` calls it
at config load; `global-setup.ts` already did. The middle one is new and
load-bearing: read out of the installed runner, Playwright starts
`webServer` **before** `globalSetup`, so until now `next start` booted
against whatever `DATABASE_URL` the shell had before anything refused.
The runner never reads `DATABASE_URL`, `DIRECT_URL` or the blob token from
`apps/web/.env` — only the Clerk keys, and it refuses `_live_` ones. The
server under test gets a **fake** blob token (`e2estore`) and a blank
`ANTHROPIC_API_KEY`, so it cannot write a real store or spend a model call;
the subcontract upload is answered in the browser with a URL the app's own
`documentUrlProblem` check then accepts *because* it names that store.
Nothing in the app is told it is under test.

**One dev dependency, and its cost.** `embedded-postgres@16.14.0-beta.17`
(MIT): this machine has no Postgres and no Docker, and the guard above
makes a local one mandatory. It is a 131 MB platform binary per install,
and its postinstall — which recreates symlinks npm tarballs drop — needs
the `pnpm.onlyBuiltDependencies` entry in the root `package.json`; without
it Postgres dies on `libicudata.68.dylib` before the first test, which is
how the first run here ended. `E2E_DATABASE_URL` uses a Postgres you
already run instead — through the same guard, so still loopback and still
`_test`.

**Proved it can fail, not just pass — three times, on real defects.** The
final run against `main` (`0c4f374`): spine steps 1-10 green in 55s,
including all eight job tabs and every one of the sidebar's destinations
(each collapsed nav group opened first — the first version read ten links
and would have swept a tenth of the product). Red, by name: `2,800` →
*"the page shows 'Server Components render'"*; `12,500` → *"the page
shows 'This page didn't load'"*; `0.10` → *"retainage reads back as '0.1'
with no refusal and no dollar figure on screen"*. And a fourth nobody was
looking for: **step 11 caught a React hydration mismatch (#418) in the
shared signed-in shell**, on `/ask`, `/bids`, `/catalog`, `/contacts` and
`/equipment` in one run, `/jobs/<id>/retainage` in another, nothing in a
third — the server's HTML and the browser's first render disagree on
roughly one page in seven, intermittently, which is the shape of
something rendered from "now". It is asserted LAST rather than mid-spine,
because failing step 6 over it skipped the invoice steps this file exists
for; the run still goes red and lists every URL. Filed as a follow-up.

**One vacuous pass, caught by its own annotation.** The first version of
the known-bad cases passed on `main` with the fix unmerged: their refusal
check asked `count() > 0` on `[role="alert"]`, some empty alert slot was
in the DOM, and an empty string is not the redacted sentence. Every case
now attaches the page text it saw and records `accepted` / `refused` /
`crashed`, and that attachment is what showed "refused" with no refusal
anywhere. A refusal has to be visible and say something — the
needle-already-on-the-page trap, wearing an ARIA role.
