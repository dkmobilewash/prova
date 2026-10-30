# CLAUDE.md — how agents work on Prova

Prova is an operating system for specialty-trade construction
subcontractors (framing/drywall, plaster, EIFS, ceilings, fireproofing)
working under GCs. Every design decision is made for the sub, not the GC.
Two people build it: Cyrus (cyrusobiz-coder — not an engineer; he runs
and clicks everything) and Diego (dkmobilewash — engineer, owns the
Vercel deployment and repo settings). Each drives their own agent.

## The prime directive: verify by result, never by claim

- Merged = `git log main..origin/<branch>` prints nothing — that is the
  proof for a MERGE commit. This repo squashes PRs, which writes the
  changes as a new commit with a new SHA, so the branch's original commit
  never becomes an ancestor and that command still prints it after a
  successful squash. Proof for a squash merge = `git log --oneline
  origin/main` names the squash commit (PR title + `(#NNN)`) and
  `git show <sha> --stat` lists the same files. A PR exists =
  its ref is in `git ls-remote origin 'refs/pull/*/head'`. Migrations
  exist = `prisma migrate status` NAMES them (it has printed "No
  migration found" and "up to date" in the same run).
- `typecheck`, `lint`, and a full `build` passing is necessary and
  nowhere near sufficient. Real bugs here have only ever been found by
  loading the page and doing the thing. After building anything, give
  Cyrus a numbered click-list with the exact expected result, phrased so
  a wrong result is unmistakable.

  **A machine now does the first pass of that clicking: `pnpm test:e2e`**
  (from the repo root). It boots a throwaway Postgres, builds the app the
  way production runs it, signs a real Clerk test user in through a real
  Chromium, and walks the pilot journey in order — first job, estimate
  line, executed subcontract, contracted, retainage, first invoice, every
  job tab, dashboard, jobs list, every nav destination — failing on any
  page that shows an error boundary or renders nothing. It exists because
  on 2026-09-21 all four CI checks and 5,800 unit tests were green while
  creating one invoice crashed every authenticated page. It does not
  replace the click-list; it is the floor under it. Read
  `apps/web/e2e/run.mjs`'s header before changing what it touches.

  **CI runs it now — `ci.yml`'s `e2e-public` and `e2e` jobs — and BOTH
  halves run.** `e2e-public` needs no credentials and walks every page
  reachable without signing in, at 320, 375 and a 1280 control. `e2e` is the
  pilot journey and everything else behind sign-in: 63 specs, signed in
  through a real Chromium against the `striking-jaybird` DEVELOPMENT
  instance's `pk_test_`/`sk_test_` keys.

  **This paragraph said the opposite for two days, and it was TRUE when it
  was written.** It said half of CI was RED until two repository secrets
  existed, that `e2e` failed on its FIRST step in seconds naming
  `E2E_CLERK_PUBLISHABLE_KEY` and `E2E_CLERK_SECRET_KEY`, and that until
  they were added NOTHING behind sign-in was checked in a browser whatever
  colour the run was. Every word of that was accurate for about thirteen
  hours. Corrected 2026-09-26 from the job logs at both ends:

  | when | the `e2e` job's first step | what ran |
  | --- | --- | --- |
  | 2026-09-24 04:37:16Z, #486's own merge | `##[error]Missing repository secret(s): E2E_CLERK_PUBLISHABLE_KEY E2E_CLERK_SECRET_KEY` | nothing — the whole job log is 268 lines and it died 17s in |
  | 2026-09-24 17:42Z | passed | the suite, on a 1,650-line log |
  | 2026-09-26 05:24Z (`3889b179`) | passed | the journey, 3m13s, every step green |
  | 2026-09-26 05:54Z (`d6fa3a6f`) | passed | `verdicts: collected 63, returned 63`, 62 passing |

  So the secrets were added the same day #486 landed, and the sentence
  telling everyone they were missing outlived them by two days — long enough
  that three separate agents flagged it in one session, each of them
  correctly declining to fix it inline because an audit ships alone.

  The step still FAILS rather than skips, and that part needs no correction:
  a green check for a suite that signed nobody in is the vacuous green this
  whole directory exists to end. It also refuses a `pk_live_`/`sk_live_` key
  outright, because this suite MINTS users.

  **The old paragraph's last clause was the only part that survived, so read
  it as the rule rather than the afterthought it looked like:** read the
  `e2e` job's first step, not this file, before believing anything about
  what CI signed in as. A sentence about a missing credential starts
  expiring the moment somebody with the dashboard open does the obvious
  thing, and nothing tells the file. Same shape as the `InvoiceCounter`
  entry below, where both versions of the entry were true when written —
  except that here the stale version was the one that said a capability was
  MISSING, which is the direction that stops people looking.

  Two things that entry should not be read as saying. It does NOT mean the
  laptop keyring grew the `workflow` scope — it has not, and the Git-rules
  bullet below stands; these jobs were pushed from a cloud container whose
  token is a different token. And `pnpm test:e2e` still cannot run inside an
  agent container at all: the Clerk FAPI host and `cdn.playwright.dev` are
  both denied by the egress proxy, so there is no browser to drive. The CI
  run on your own PR is where the journey is either proved or not.
- Say plainly when something is your fault, what broke, and what changes.

## Coordination

- Slack `#prova-build` (C0BSUM5G4T0) is the shared channel between the
  two agents. Before writing code: `git fetch && git log --oneline -20
  origin/main` AND read the last ~20 channel messages. After anything
  lands on main: post one line. Before touching a file in the other
  lane: post and wait. NEVER post connection strings, keys, or tokens
  anywhere — Signal or a call only.
- Lanes are in WORK-SPLIT.md. Diego: estimating, job costing,
  billing/AIA, retainage, WIP, and `apps/web/app/(app)/jobs/[id]/page.tsx`
  (fixed section slots: Retainage → Field Reports → Pay Apps — insert at
  your slot, never at the end). Cyrus: self-contained verticals (safety,
  vendors, equipment, punch lists, RFIs, submittals). Shared, edit
  surgically: schema files, `middleware.ts`, `navItems.tsx`,
  `lib/actions/shared.ts`, the actions barrel.

  **AI IS SHARED, FROM 2026-10-12 — NEITHER PERSON'S LANE.** Agreed by
  both in `#prova-build` that day: no split. Whoever is working on an AI
  piece (Ask, the agents and `/ai`, the model integration, the AI switch,
  AI extraction, usage metering, the takeoff/estimating AI) keeps it; ask
  before changing something the other is actively working on. The money
  and estimating logic under any AI feature stays Diego's.

  **READ THE SHAPE OF THIS ENTRY BEFORE ITS CONTENT, because it has now been
  in three states (Diego's, Cyrus's, shared) and each was true when written.** This
  paragraph said AI was Diego's until 2026-09-21, then said in bold that it
  had "moved from Diego to Cyrus" and that "any older line in this repo or
  its PR history calling AI 'Diego's lane' is stale" — which was correct for
  five days and is now itself the stale line it warned about. An ownership
  claim is not a fact about the code; it is a fact about an agreement between
  two people, and it perishes the moment they agree something else. The
  older-lines warning is the part that aged worst: it told a reader to
  distrust exactly the sentence that is true today. So this version names the
  date and does not tell anybody which other lines to disbelieve.

  Diego announced it in `#prova-build` on 2026-09-26 and said he would tell
  Cyrus directly. If you are Cyrus's agent and this is the first you are
  hearing of it, that is the thing to check rather than the code.

  The split for a feature that sits on both is unchanged and still the right
  rule, now with both halves on the same side: where an AI feature reads
  Diego's numbers (Ask's `draft_invoice`, the WIP narrative), the arithmetic
  underneath stays deterministic code and the model only narrates what it is
  handed — see ARCHITECTURE.md. That was never a lane boundary; it is the
  product rule, and it survives the ownership change intact.

  Corrected 2026-09-02: this line said `Sidebar.tsx` for weeks and it is
  the wrong file. `Sidebar.tsx` renders whatever `navGroupsFor()` hands
  it — that is its whole content — and the nav entries themselves live in
  `components/navItems.tsx`, which also builds the groups. Add a route to
  `Sidebar.tsx` and nothing appears, with no error to say why.
  WORK-SPLIT.md's third-lane note has said `navItems.tsx` since 1 Sep;
  this file disagreed with it and lost.

  Two things this entry got slightly wrong and are fixed 2026-09-06.
  It gave `Sidebar.tsx` a line count and `navItems.tsx` an entry count,
  and both had moved within days — counts of that kind rot faster than
  the claim they decorate, so they are gone rather than refreshed. And
  the capability map is NOT in `navItems.tsx`: `ROUTE_CAPABILITY` and
  `capabilitiesFor()` are in `lib/permissions.ts`, `requireCapability()`
  is in `lib/authz.ts`. Nav and capability are two files, not one.

  Also verified 2026-09-02, re-verified 2026-09-06: the three "fixed
  section slots" are real and in that order — Retainage, then
  `<DailyFieldReports>`, then `<PayApplications>` — but NOTHING IN THE
  FILE MARKS THEM. There is no comment, no sentinel, no named slot. Field
  Reports and Pay Apps are still literally the last two elements before
  the closing tags, so "insert at your slot, never at the end" is advice
  you can only follow if you already knew the order, which is why it is
  written here. Read this line before you edit that file; the file will
  not tell you. (Deliberately no line numbers: the file grew from 1955 to
  2007 lines in four days and every number this paragraph used to carry
  was stale.)

## The working agreement (agreed in Slack 2026-08-29)

Written down here because an agreement that lives only in a Slack
scrollback gets broken by whoever didn't scroll far enough.

1. **No PR smaller than a finished, clicked-through capability.** Several
   capabilities in one PR is fine and usually better. No docs-only PRs —
   documentation rides along with the work it describes.

   **EXCEPTION, granted by Diego 2026-09-07: an AUDIT may ship alone, and
   must still be flagged as docs-only in the PR.** Three of them landed in
   one session (#186, #191 and the correction before them), each argued
   separately, which is the shape of a rule being eroded one reasonable
   case at a time rather than changed on purpose. So it is changed on
   purpose.

   The reason the rule does not fit an audit: rule 1 exists so
   documentation cannot drift from the code it describes. An audit is the
   opposite motion — it is documentation being dragged BACK to the code
   after it has already drifted, and there is no accompanying change for
   it to ride along with. Making it wait for one is how a known-false
   sentence stays on `main`, which this file has paid for repeatedly (the
   one-Neon-project sentence cost two people a day; "invoice numbers come
   from a counter" stopped anyone looking at `max(n)+1` on a GC-facing
   document).

   **What qualifies**, deliberately narrow, because an exception without a
   boundary is a repeal:

     - correcting a documented claim that is false, unverified, or now
       stale — and saying which, with the evidence;
     - recording what an investigation established or ELIMINATED, so the
       next person does not re-run the same checks.

   **What does not qualify**, and still rides along with code: writing up
   a feature you just built; renaming or restyling prose; reorganising a
   document nobody has found wrong. If the only thing that changed is how
   the words read, it is not an audit.

   Flagging stays REQUIRED, and is the point of the exception rather than
   a formality — a docs-only PR that does not say it is one has skipped
   the only check on whether it qualifies.
2. **Never open a PR based on another PR's branch.** Stacking commits on a
   branch that already has an open PR is fine; that is a different thing.
   Stacked PRs stranded commits twice, because GitHub only retargets a
   base branch when it is DELETED after merging. See the Git rules below.
3. **A bug in the other person's lane becomes a GitHub issue assigned to
   them** — not a PR, and not a Slack essay. EXCEPTION: a live money bug,
   or anything touching the Neon data, gets a ping immediately.
4. **Anything touching the shared schema or adding a migration is
   announced in Slack BEFORE the push**, not on merge. Early enough that
   the other person can object while objecting is still cheap.

## Git rules (each one is a scar, not a preference)

- NEVER `git add -A` — a wildcard add swept live credentials into a
  public repo. Explicit paths only. Agreed by both sides.
- Never assume repo state — assert branch, cleanliness, and remote tips
  before acting, and fail loudly.
- **A merge does not move commits you didn't check.** Both of us stranded
  commits on 2026-08-28. A stacked PR merges into ITS BASE, not `main` —
  GitHub only retargets one when the base branch is DELETED after merging,
  which is not the default. #15 merged into `cyrus/submittals` and left
  material orders, the CI test step and the CLAUDE.md corrections outside
  `main` for eight hours, with every check green the whole time. #13
  merged at its then-head and left two commits behind, one a live
  money-display bug. So: delete the branch when you merge a stacked PR,
  and after ANY merge confirm it landed. For a merge commit, `git log
  origin/main..<branch>` is empty. For a squash merge (the default here)
  the branch's commit is rewritten under a new SHA, so that command still
  prints it — instead confirm `git log --oneline origin/main` names the
  squash commit (PR title + `(#NNN)`) and `git show <sha> --stat` lists
  the same files. "The PR says Merged" is not.
- Scripts start with `set -e` AND `set -o pipefail` (a failed build
  piped to `tee` printed ALL GREEN once), and clear a stale index lock
  with `rm -f "$(git rev-parse --git-path index.lock)"`.

  Corrected 2026-09-06: this line named the bare `rm -f .git/index.lock`
  for weeks, which is the exact form the repo abandoned — it is ENOTDIR
  in a worktree and takes the whole script down with `set -e`. The
  worktree entry further down explains why; this bullet was still
  handing out the broken version to anyone writing a new script, which is
  how a fixed bug gets reintroduced from the documentation.
- Cyrus authenticates through `gh` (token in the macOS keyring; scopes
  `repo`, `workflow`, `read:org`, `gist`), so `.github/workflows/` IS
  editable from the CLI, and `gh pr create` works. The older PAT lacked
  `workflow` and pushes touching that folder were rejected — no longer
  true as of 2026-08-28. `gh auth setup-git` is what makes git push use
  that token; without it the stale keychain entry wins and pushes fail
  with "Invalid username or token".

  **The `workflow` scope in that list is NOT what the keyring holds, as
  of 2026-09-21.** `gh auth status` on Cyrus's laptop prints `'gist',
  'read:org', 'repo'` — no `workflow` — so a push touching
  `.github/workflows/` is rejected exactly as the "older PAT" paragraph
  above describes. #364 hit this and left its CI job as a diff in the PR
  body; the E2E journey PR hit it again three weeks later, from this same
  keyring, because this bullet said the problem was gone. The fix is one
  interactive command Cyrus runs himself — `gh auth refresh -h github.com
  -s workflow` — followed by `gh auth setup-git`; an agent cannot complete
  the device-code prompt. Verify with `gh auth status`, not with this
  paragraph.
- `.git/info/exclude` patterns must be anchored with `/` (an unanchored
  `punch-lists*` matched a source directory).
- CI (`ci.yml`) runs test → lint → typecheck → build. This file used to
  claim CI skipped `build`; that was never true — `32ea10a` added Build
  with the workflow itself. Run `./scripts/preflight.sh` before pushing
  anyway: same four checks, plus it names the migrations that push will
  apply to PRODUCTION and refuses destructive ones.
- **GREEN CHECKS ON A PR DO NOT MEAN CI RAN ON YOUR COMMIT.** `ci.yml`
  triggers on `pull_request`, and its `push` trigger is limited to `main` —
  so on a feature branch the PR event is the ONLY thing that runs CI.
  GitHub cannot build the merge commit a `pull_request` event needs while
  the branch CONFLICTS with its base, so the workflow is never queued. Not
  failed. Never queued. Nothing anywhere says so, and an absent check reads
  exactly like a passing one.

  Cyrus hit this on #59 (2026-09-02). `gh pr checks 59 --watch` exited 0
  with everything green, and CI had never run on `19bb374` at all: the two
  Vercel checks that DID report were the whole of the green, and the newest
  CI run was still `5e77e54`, one commit behind. Confirmed from the API
  rather than from the claim — the runs on that branch name seven head
  SHAs and `19bb374` is not among them.

  So `gh pr checks` answers "did the checks that ran, pass". It does not
  answer "did anything run on THIS commit", which is the question. THE
  CHECK IS THE SHA, NEVER THE COLOUR: take the head SHA of the newest
  `ci.yml` run for your branch and require it to equal `git rev-parse
  HEAD`. That is what settled #59 — the API lists seven head SHAs for
  `cyrus/notifications` and `19bb374` is not one of them.

      gh run list --branch <branch> --workflow ci.yml --limit 1 \
        --json headSha,conclusion
      git rev-parse HEAD    # these two must match

  (The `gh` form above is written from its documented `--json` fields and
  was NOT executed by the session that added this entry, which had no `gh`.
  The comparison is the rule; if a flag has drifted, fix the flag.)

  Same shape as the promotion and stacked-PR scars above: the checks were
  not lying, they were answering about a commit nobody asked them about.
  A conflicted PR is therefore untested by definition — resolve the
  conflict FIRST, then read CI.
- **A `status` field can also be stale the OTHER way — pending long after
  the work finished.** The companion to the entry above, and learned by
  getting it wrong twice in one session (2026-09-03). Both times the job
  was already done and the API had not caught up, and both times the
  agent reported a slow build to Diego and started reasoning about why:

  | Polled | API said | Its own timestamps said |
  | --- | --- | --- |
  | Vercel `dpl_yWKcK3mpQ…` for ~20 min | `BUILDING` | `buildingAt`→`ready` = **87s** |
  | GitHub `ci` on #74 for ~13 min | `in_progress` | `started_at`→`completed_at` = **104s** |

  **The timestamps are the truth; the status field is a cache.** When a
  duration looks anomalous, compute it from `ready`/`completed_at` before
  believing it and before theorising about a cause. An 87-second build
  described as twenty minutes sends somebody hunting for an OOM that
  never happened — this repo has a real exit-137 scar, which is exactly
  what makes the false alarm expensive.

  Two things that DID work as cross-checks, both cheap: Vercel's
  `errorsOnly` build log returned no error, stderr or exit events, and
  GitHub's job log 404s until a job completes. Neither says "finished",
  but together they distinguish "still working" from "died silently",
  which is the question actually worth answering while you wait.

  **For a GitHub job, ask for its STEPS.** `list_workflow_jobs` (REST:
  `/actions/runs/{run_id}/jobs`) returns every step with its own
  `started_at`/`completed_at`, and those are not the cached field. On #82
  the job read `in_progress` while its steps already showed Test ✓ 6s,
  Lint ✓ 8s, Typecheck ✓ 20s, Build ✓ 57s — a 114-second run that was
  polled as running long after it finished. Steps tell you WHICH stage is
  slow, so "the build is hanging" becomes a claim you can check instead of
  one you guess. Nothing here needed inventing; it was one call away the
  whole time this file's author was watching a status field.

## Hard-won technical rules

- **ALL UI MUST FOLLOW `DESIGN.md`. Don't use default shadcn styling.**
  `DESIGN.md` is the prose authority; `apps/mobile/lib/theme.ts` is its
  executable copy and wins where they disagree. It governs the PHONE —
  `apps/web` is dark-only and keeps its own tokens in
  `apps/web/tailwind.config.ts`, which `DESIGN.md` deliberately does not
  touch. Two things that make the shadcn clause concrete rather than
  decorative: shadcn is **not installed here** (no `components.json`, no
  `@/components/ui` imports), and the reference design this system was
  extracted from shipped an untouched default shadcn `button.tsx` that its
  own pages never imported. So if v0, a generator or a copied snippet
  brings `bg-primary`/`text-primary-foreground` in, retoken it to
  `DESIGN.md` before it lands — those semantic names resolve to nothing in
  this repo and render unstyled. `DESIGN.md`'s deviations table records
  where we deliberately diverge from the reference and why; read it before
  "fixing" one back.

- **Sequence numbers** come from a counter row that only increments,
  bumped inside the same transaction as the insert. Never `max(n)+1`,
  never `count()+1` — anything derived from surviving rows is reissued
  when a row is deleted. `SafetyCaseCounter`, `RfiCounter`,
  `SubmittalCounter` and `MaterialOrderCounter` (`operations.prisma`),
  `ChangeOrderCounter` (`jobs.prisma`), `BackchargeCounter`
  (`backcharges.prisma`), `CloseoutSubmissionCounter` (`closeout.prisma`),
  `InvoiceCounter` and `ContractDocumentVersionCounter`
  (`billing.prisma`), `EstimateVersionCounter` (`estimating.prisma`),
  `Wh347PayrollCounter` (`payroll-register.prisma`).

  The last two were added 2026-09-24 by reading the schema: this roll-call
  named nine and the schema declared eleven. Nobody broke a rule — the
  paragraph below says to add the counter here and let the test say how many
  there are, and `counterCensus.test.ts` holds a FLOOR (`>= 9`) rather than
  an equality, deliberately, so that adding a counter does not fail a build
  over a number. That is the right trade and it has a cost: the floor cannot
  notice this list falling behind the schema. Derive it rather than trust it —
  `grep -c '^model .*Counter {' packages/db/prisma/schema/*.prisma`.

  **THE COUNT THAT USED TO BE IN THAT SENTENCE IS NOW A TEST, and the
  reason is that it rotted in a day.** This paragraph said EIGHT, with two
  shell commands to re-derive it rather than be trusted, and noted that a
  bare count is the kind this file deletes elsewhere for rotting faster
  than the claim it decorates. #228 added `ContractDocumentVersionCounter`
  the following morning. Both commands printed 9; the prose still said 8.

  The commands were right to be there — they are what caught it, in one
  line, rather than anyone noticing. But a re-derivation nobody runs is a
  claim with an expiry date, so it lives in
  `apps/web/lib/counterCensus.test.ts` now and fails the build instead:
  every counter model is bumped through a TRANSACTION client, none is
  bumped on the bare `prisma` client, and no counter model exists that
  nothing increments — the "written, documented, and never called" shape
  wearing a schema. It counts what it parses against a literal that cannot
  drift with the pattern, so a regex matching nothing fails loudly rather
  than passing everything downstream.

  Do not re-add a number here. Add the counter to the roll-call above and
  let the test say how many there are.

  **INVOICE NUMBERS JOINED THEM 2026-09-09, and this entry said the
  opposite for a week.** #224 (`c5da778`) added `InvoiceCounter` and
  `issueInvoiceNumber`, which copies `issueRfiNumber` and takes the
  transaction client, so the bump and the insert are one transaction.
  Migration `20260909180000_add_invoice_counter`, applied to
  `ep-little-sea` by `Migrate` run `34394634352`.

  **Read the shape of this correction before the content of it.** For a
  week this file said invoice numbers came from a counter when they did
  not, and that sentence stopped anyone looking. It was then corrected to
  say they did not — and two hours after #224 merged, THAT was the false
  sentence, pointing the next agent at a fix already made. A claim about
  what the code does not have is exactly as perishable as a claim about
  what it does. Both versions of this entry were true when written.

  **What #224 also established, and it is worth more than the fix.** The
  headline this entry led with — "delete invoice 3 of 3 and the next
  invoice is 3 again, on a document a GC has already been sent" —
  described something the product CANNOT DO. There is no `deleteInvoice`
  in this app; every `invoice.delete`/`deleteMany` in the repo is dbtest
  teardown, `clean-scratch-data.mjs` or `seed-demo.mjs`. That is
  deliberate, and it is this file's own evidence-record rule: sent
  correspondence closes, it never deletes. So the scariest sentence in the
  entry was unreachable, and the real defect was the one mentioned last
  and in passing: two concurrent submits read the same max and the second
  collided on `@@unique([jobId, number])`, throwing a message production
  REDACTS, with `createInvoice` returning void so there was nothing to
  render. Reproduced, not argued — the mutation test throws
  `Unique constraint failed on the fields: (jobId, number)`.

  The lesson for the next entry somebody writes here: a vivid failure
  nobody can reach makes a bug look urgent for the wrong reason, and the
  boring one underneath it goes unfixed for a week.

  **The migration BACKFILLS from `MAX(number)` per job**, and that line is
  load-bearing rather than tidy: a counter starting at zero would make the
  first invoice on every existing job collide with its own history. Tested
  against a real Postgres 16 — seed invoices 1-3, apply the migration,
  get `lastNumber` 3 and a next number of 4; delete the backfilled row and
  the counter issues 1, whose insert fails on `Invoice_jobId_number_key`.
  One case cannot be fixed and is not pretended away: a job whose invoices
  were ALL deleted before that migration starts at 1 again, since nothing
  records what it once issued.

  **AND A NEW COUNTER IS NOT DONE WHEN IT ISSUES NUMBERS CORRECTLY.** #224
  was right about numbering and still broke both cleanup scripts, which is
  the half of it neither that PR nor the correction above caught. A per-job
  counter is a RESTRICT child of `Job` that deleting the job's invoices does
  NOT reach — it is keyed on `jobId`, so it outlives them and then refuses
  the job delete. Adding one is three edits, not one: the model,
  `HANDLED_MODELS` in `packages/db/scripts/scratch-scope.mjs`, and the
  `del(...)` order in BOTH `clean-scratch-data.mjs` and `seed-demo.mjs`.
  Fixed for `InvoiceCounter` in #227; the guard that should have caught it
  has its own entry under Traps, because it was green the whole time.

  `SafetyCaseCounter` is the one counter deliberately NOT in those lists:
  company-scoped, a high-water mark rather than per-job data, and resetting
  it reissues a retired OSHA case number (issue #148). Per-job counters go
  with their job; company-level ones never do.
- **Derived state is never stored** (overdue, recordable, current
  revision) — a stored flag can disagree with what it was derived from.
- **Evidence records** (safety incidents, RFIs, submittals, invoices):
  identity fields locked after creation; sent correspondence can close
  but never delete; dates that matter are ENTERED, not stamped.
- **Dates**: stored at UTC midnight, rendered in UTC. Form defaults use
  `components/localToday.ts` (the USER'S calendar date) and only in
  components mounted by a user action, never server-rendered markup —
  otherwise hydration breaks.
- **Errors**: production REDACTS thrown Server Action messages (verified
  2026-08-27 on a real production build). New actions return
  `{ ok: true } | { ok: false, error }` and forms render the result —
  `lib/actions/submittals.ts` is the reference. `throw` is for genuine
  bugs only. The `ActionResult` type and its `actionOk`/`actionFail`
  helpers live in `lib/actions/shared.ts` — NOT in a feature module and
  NOT in the barrel: two feature modules exporting the same type name is
  a `TS2308` build break, since the barrel `export *`s all of them.
- **List pages** all follow the same conventions: add-form collapsed
  behind a button; inline row edit; two-step delete (never
  `window.confirm`); one shared `*Fields` component for create+edit;
  real empty states with a way out; owner-only destructive actions
  refused with `ownerRefusal(context, "specific message")`.

  **That last clause said `assertOwner` until 2026-09-16 and following it
  FAILED THE BUILD.** Found by a branch that did exactly what this bullet
  told it to. `assertOwner` THROWS, and the bullet above about errors is
  the reason that matters: production redacts a thrown Server Action
  message to a digest, so a refusal written here reads perfectly in
  `next dev` and reaches a real user as a dead button.

  `apps/web/lib/ownerRefusalCensus.test.ts` exists to catch precisely
  this, and its own header says so — *"an action that promises a readable
  refusal must not refuse by throwing… `assertOwner`, which throws, breaks
  that promise for the owner case only."* It fails the build when an action
  declaring `Promise<ActionResult>` refuses by throwing.

  So the two are not interchangeable and both are correct in their own
  place: **`ownerRefusal` returns `{ ok: false, error }` or `null` and
  belongs in anything returning `ActionResult`; `assertOwner` throws and
  belongs only in the older throw-style actions** that have no ActionResult
  to return. `shared.ts` documents the pair at length, which is where this
  bullet should have been read from rather than repeated from memory.

  The shape is this file's most expensive recurring one: a sentence that
  was true when the convention was younger, left standing after the
  convention grew a second half, and then handed to somebody as
  instructions. The guard caught it in seconds — the cost was only that a
  branch built the wrong thing first.

## UI rules (the phone, and anything a gloved hand touches)

Added 2026-09-26 with the token delta they describe. The phone is the
only surface in this product used outdoors, in gloves, one-handed, by
somebody who did not choose the software — so these are not style
preferences and they are not covered by any of the installed skills.

### Which skill for which task

Name the skill; do not go looking for a general one.

| Task | Skill |
| --- | --- |
| iOS conventions, navigation, controls, status | `apple-hig-skills:hig-foundations`, `hig-patterns`, `hig-inputs`, `hig-components-*` |
| React Native structure, lists, navigation | `building-react-native-apps:react-native-best-practices`, `react-navigation`, `frontend-mobile-development:react-native-architecture` |
| Expo routing, native modules, dev/EAS builds | `expo:expo-router`, `expo-dev-client`, `eas-app-stores`, `eas-update` |
| Tokens, theming, component libraries | `ux-ui-agent-skills:design-tokens`, `token-build`, `governance`, `ui-design:design-system-patterns` |
| Accessibility audits and screen-reader checks | `accessibility-compliance:wcag-audit-patterns`, `screen-reader-testing`, `ux-ui-agent-skills:a11y-audit` |
| Figma → code | `figma:figma-design-to-code`, `figma-code-connect` (authenticate the Figma MCP first) |

### Tokens, not values

Every colour, space, radius, type size and touch target comes from
`apps/mobile/lib/theme.ts`. No hex, no bare numbers. Four censuses fail
the build rather than a reviewer catching it: `design-tokens.test.ts`
(hex, radius, gap, padding/margin, lineHeight-in-points),
`theme-contrast.test.ts` (every ink/ground pair, in every palette),
`theme-parity.test.ts` (one vocabulary across light, dark and outdoor),
`touch-targets.test.ts` (the 48pt floor).

A value that genuinely is not on the grid gets a NAME in `space` and a
reason, as `control`, `controlX`, `badge` and `scrollBottom` did — it
does not get to stay a number.

### Field-use rules (no skill covers these)

- **Primary actions are at least 56pt tall** (`hitTargetPrimary`);
  everything tappable clears **48** (`hitTarget`). 48 rather than
  Apple's 44 because these hands are in gloves and Android's own floor
  is 48dp.
- **Destructive actions are separated from the action beside them and
  confirmed in two steps** — and read the "Cancel inherits the delete
  pixel" entry under Traps before placing the pair, on either surface.
- **Key actions live in the bottom third of the screen.** The phone is
  held in one hand, often on a ladder.
- **7:1 for text on any screen used outdoors**, which on the phone is
  all of them; 3:1 for borders and non-text. No meaning carried by
  colour alone — a status is a word and a colour, never a colour.
- **Every screen that loads or saves shows offline, queued and synced
  states.** `cache-parity.test.ts` and `offline-notes.test.ts` enforce
  the read half; the outbox (`app/outbox.tsx`) is the write half.
- **Prefer pickers, steppers and chips to typing**, and give a numeric
  keypad for numbers (`keyboardType="decimal-pad"`).
- **Photo capture tags each photo to a job and a log, and queues the
  upload** for when there is signal. Never a bare camera roll write.

### Before a screen is finished

Self-review it against `accessibility-compliance:wcag-audit-patterns`
and `apple-hig-skills:hig-patterns` — the two that cover what the
censuses cannot see: labels and roles on every control, a reading order
that makes sense, and whether the screen still works at the largest
Dynamic Type size. **No test in this repo can see layout**: the screen
suite renders in happy-dom, which does no layout and returns zeros from
`getBoundingClientRect`. That is how a 1.35-POINT line height shipped on
five screens. A phone or a simulator is the only instrument for
anything about SIZE.

## Traps that already fired — do not rediscover

- `export *` inside a `"use server"` file fails only at `build`, not
  typecheck. The actions barrel (`lib/actions/index.ts`) is deliberately
  NOT "use server".
- Prisma migrations MUST live inside `packages/db/prisma/schema/`
  (multi-file schema). Orphaned outside it, Prisma silently finds zero
  migrations and reports the DB up to date.
- `DATABASE_URL` = Neon pooled endpoint (`-pooler`) with
  `connection_limit=5&pool_timeout=30&connect_timeout=30`; `DIRECT_URL`
  = direct endpoint; migrate cannot run through a pooler. Neon suspends
  idle computes — the first request after a quiet period must survive
  the wake.
- Edit code by reading the actual text and replacing it exactly — a
  structural regex once inserted code into the wrong block and produced
  14 cascading errors.
- **THERE ARE TWO CLERK INSTANCES, AND THE DASHBOARD LOOKS IDENTICAL IN
  BOTH.** Same shape of confusion as the two Neon projects below, so the
  same rule: name the instance, never say "Clerk" or "the domain".

  | Instance | Primary domain | Keys | Holds |
  | --- | --- | --- | --- |
  | Development | `striking-jaybird-….clerk.accounts.dev` | `pk_test_`/`sk_test_` | the original users |
  | Production | `cstream.ai` (FAPI at `clerk.cstream.ai`) | `pk_live_`/`sk_live_` | the live users |
  | Cyrus's laptop | `smart-rattler-7073.clerk.accounts.dev` | its own `pk_test_`/`sk_test_` | his local test users |

  **THREE now, not two — the third is a separate Clerk APP, not a third
  instance of the same one.** Established 2026-09-10 while rebuilding
  Cyrus's laptop from nothing, which is exactly the situation this entry
  exists for and the one it failed: this table sent that rebuild hunting
  for `striking-jaybird` keys that Cyrus's Clerk account cannot see at
  all. His local stack is its own app named Prova, in his own Clerk
  organisation ("Cyrus's Organization", Development environment only —
  the dashboard shows "No Production Environment"), and it pairs with his
  own Neon project: `smart-rattler-7073` + `ep-icy-hat`, the laptop-local
  mirror of the three-Neon-projects table below. Proved by result, not
  inference — signing in locally with `smart-rattler` keys against
  `ep-icy-hat` showed the test jobs created before the old laptop died,
  so that pairing is what his data actually lives under. The rule the
  table already states covers this row too: name the instance. "The dev
  keys" now means two different things, only one of which a given person
  can obtain — `striking-jaybird`'s from Diego's dashboard,
  `smart-rattler`'s from Cyrus's.

  The app is at **app.cstream.ai**. Clerk takes the registrable ROOT for
  its own infrastructure, so its DNS records are `clerk`, `clkmail`,
  `clk._domainkey`, `clk2._domainkey` at the root — NOT `clerk.app`. Two
  hours were spent on the assumption that they sat under the subdomain.

  A primary domain CANNOT be changed once set; the dashboard offers
  "Change domain" and then refuses, and there is no delete-instance
  button. Clerk support does it. Get the domain right at creation.

  **Switching instances gives the same person a NEW clerkId with the SAME
  email, and both are unique on User.** That 500'd every page until
  `requireCompanyContext` learned to adopt a row found by a VERIFIED
  email. The verification gate is the security of it — without it, signing
  up as someone else's address inherits their company.

  A vercel.app host cannot be a Clerk production domain via DNS (Vercel
  owns the domain), only via a proxy at `/__clerk`, and that proxy needs
  `@clerk/nextjs` v7. We are on 6.x. `/__clerk/:path*` is in the
  middleware matcher and inert; leave it.

  **A PREVIEW CANNOT BE CLICKED WITH A PRODUCTION SESSION, and that is
  this table doing its job rather than anything being broken.** Established
  2026-09-09 while clicking #214. Previews run the DEVELOPMENT instance —
  its sign-in box says "Development mode" in orange, which is the tell —
  and `app.cstream.ai` runs the Production one. Being signed into the app
  therefore does nothing for a preview: it redirects to
  `/sign-in?redirect_url=…` and stays there. Sign in on the preview
  separately.

  The trap is what happens NEXT, and it looks like a broken feature.
  `requireCompanyContext` (`lib/auth.ts`) adopts a row by verified email,
  but only if one exists in the database it is talking to — and a preview
  is talking to the DEMO project, not production. An address with no row
  there falls through to the create branch and silently gets a brand new
  company named "<Your Name>'s Company", empty. Every list page then shows
  its empty state, which reads exactly like the feature you came to click
  is broken. If a preview shows you no jobs, check whether you are in a
  company you just created before you go looking at the code. The **Seed
  demo data** workflow scopes to the oldest company or a `company_id` you
  pass; it seeds jobs, not photos.

- **A domain change breaks QuickBooks silently.** `QUICKBOOKS_REDIRECT_URI`
  has to change in Vercel AND the same string must be registered on
  Intuit's DEVELOPMENT tab (we run `QUICKBOOKS_ENVIRONMENT=sandbox`;
  a URI on the Production tab does nothing). Intuit compares strings, not
  URLs — a trailing slash fails.

  The trap is the timing. An existing connection keeps working on token
  refresh alone, which does not use the redirect URI, so a wrong one stays
  invisible until someone reconnects or the refresh token rolls (~100
  days). Test it by DISCONNECTING and reconnecting, which is safe:
  `disconnectQuickBooks` deletes only the connection row, and the account
  mapping survives.

- **THERE ARE TWO NEON PROJECTS, ONE PER PERSON. This file said there was
  one for weeks, and that sentence cost two people a day.**

  | Project | Endpoint | Used by | Holds |
  | --- | --- | --- | --- |
  | Diego's | `ep-little-sea-a6bdnaw2` | Vercel PRODUCTION only | the real data |
  | Demo | `prova-demo` (its own project) | Vercel PREVIEWS — every one | the demo dataset |
  | Cyrus's | `ep-icy-hat-afqau56u` | Cyrus's laptop only | his own test data |

  THREE now, not two. Previews used to run on production's database, which
  meant browser testing wrote real rows and every round of it needed
  cleaning up afterwards. Preview's `DATABASE_URL`/`DIRECT_URL` point at
  the demo project instead, so that is no longer true.

  The cost of that split: migrations reach production automatically on
  merge (`migrate.yml`) and the demo database gets NOTHING. It drifts the
  moment anyone adds a migration, and drift shows up on a preview as
  "column does not exist" — which reads as a code bug and is not one. Fix
  it by running the **Migrate demo database** workflow (Actions tab, Run
  workflow, and type the demo endpoint id — `ep-patient-lake` — to confirm;
  the script compares what you typed against the host the secret actually
  resolves to and refuses before applying anything, which the old `demo`
  constant could not do). It needs the `DEMO_DATABASE_URL` and
  `DEMO_DIRECT_URL` repository secrets, which are deliberately not named
  after production's so the two can never be confused.

  All of that verified against the workflow file 2026-09-02 and true.

  This entry used to carry a second paragraph here saying the demo button
  asserts its target and the PRODUCTION one does not — that `wrongTarget()`
  in `connection-target.mjs` only fires when `MIGRATE_EXPECT_HOST` is set,
  that only `migrate-demo.yml` set it, and that "nobody has wired the
  guard up". **DELETED 2026-09-06: it was true when written and is not
  true now.** `migrate.yml:97` sets `MIGRATE_EXPECT_HOST:
  ep-little-sea-a6bdnaw2`, hardcoded rather than secret so a reviewer can
  read the assertion in the diff, added 2026-09-03. Both databases are
  now guarded against a secret holding the wrong connection string, and
  if Neon ever moves production to a new endpoint that job FAILS and
  applies nothing until a person changes that line.

  Recorded because the deletion is the lesson: this audit shipped a
  correction and the correction went stale in four days while the branch
  sat unmerged. A doc note that says "nobody has fixed X" is a claim with
  an expiry date on it — re-read the code before republishing one, which
  is the only reason this paragraph is not still telling you production
  is unguarded.

  Established 2026-08-29 from: two production build logs printing
  `ep-little-sea` as the migrate target; the `Migrate` workflow printing
  the same for secrets copied out of Diego's Neon project; that project
  answering `SELECT count(*) FROM "Job"` with 14, matching what the
  deployed app shows; and Cyrus's `_prisma_migrations` timestamps showing
  merged migrations reaching `ep-icy-hat` only when he ran Prisma by hand.

  Everything confusing about that day follows from the table. A build log
  saying "successfully applied" and `migrate status` saying "not yet
  applied" were BOTH TRUE, about different databases. Neither person was
  wrong; the words "the database" meant two things.

  So: name the endpoint, never say "the database". A migration is applied
  to a HOST, and `prisma migrate status` only answers for the connection
  string it was given.

- **Cyrus's database is a dev database and is SUPPOSED to be behind.** It
  gets nothing automatically — not from CI, not from a deploy. To catch it
  up, from his own checkout with his own `.env`:

  ```
  pnpm --filter @prova/db run migrate:deploy
  ```

  That prints the host before it does anything, refuses if the two URLs
  disagree, applies what is pending, and reads `migrate status` back to
  verify rather than trusting its own success message. Do this whenever a
  page 500s locally with "column does not exist" — that error means his
  database is behind main, not that the code is broken.

- **`prisma migrate dev` offering to reset the database is NOT about
  production, on Cyrus's machine.** This file used to say it was, in
  capitals, and that was wrong: his `.env` points at his own project, so
  the reset offer is about his own dev data. It is still worth reading the
  prompt rather than reflexively accepting — losing a day's local test data
  is annoying — but it is not the loaded gun this file made it out to be.
  On a machine whose `.env` points at `ep-little-sea`, it IS production and
  the answer is always no. Check the host in the prompt; that is the whole
  test.
- **Every build now prints which database it is talking to** (host and
  name, never credentials), and refuses to build if `DATABASE_URL` and
  `DIRECT_URL` resolve to different databases. That check is
  `packages/db/scripts/check-schema.mjs`; the parsing behind it is tested
  in `apps/web/lib/db-target.test.ts` against the two endpoints that
  actually disagreed. The app logs its own connection target once per cold
  start.
- **Migrations are applied by CI on merge to main**
  (`.github/workflows/migrate.yml`), not by the Vercel build. They used to
  run in the build, gated to `VERCEL_ENV=production`. That gate was blind
  to promotion: promoting a preview to production reuses the preview's
  already-built output, so the build command never re-runs and its
  migrations never apply — and two deployments were promoted that way. The
  workflow needs `DATABASE_URL` and `DIRECT_URL` repository secrets; it
  fails loudly without them rather than skipping. A production Vercel build
  now REFUSES to build when migrations are pending; a preview only warns,
  because a branch's own migration legitimately hasn't merged yet.
- **`migrate.yml` and the Vercel build race, and the build usually loses.**
  Both fire on push to main, concurrently, and neither knows the other
  exists — so a merge carrying a migration reaches `check:schema` before the
  migration lands and the whole deployment goes red for a change that was
  fine. It has bitten twice: Cyrus's #40 (16 seconds) and #53 (19 seconds —
  build refused 18:37:47, migration verified 18:38:06).
  `check-schema.mjs` now WAITS up to 90s on a production build, polling
  every 5s, before refusing; `MIGRATE_WAIT_SECONDS` overrides it. Previews
  do not wait at all, because a pending migration is the normal state of an
  unmerged branch. Verified against a scratch database by applying a
  migration mid-wait and watching the build continue.
  Worth knowing that this was CLAIMED as done on 2026-08-30, in Slack, and
  was not built — the check refused four seconds in with no polling
  anywhere in the file. If a red production deploy on a merge still says
  "missing this commit's migrations", read the log for the wait lines
  before assuming the race: without them, you are on a build that predates
  this fix.
  Re-read line by line 2026-09-02, because a claim that was once false is
  the one worth re-checking rather than inheriting: the wait IS built now.
  `check-schema.mjs` lines 107-133 — `WAIT_SECONDS` from
  `MIGRATE_WAIT_SECONDS` defaulting to 90, `POLL_SECONDS = 5`, a
  `while (pending && Date.now() < deadline)` loop that re-runs `migrate
  status` and prints `db: <n>s — still pending` each time, guarded by
  `pending && isProduction`. Previews skip the loop entirely. The prose
  above and the code now agree.
- **A VERCEL ENVIRONMENT VARIABLE REACHES ONLY DEPLOYMENTS CREATED AFTER IT
  WAS SAVED, and a running build does not count.** 2026-09-10:
  `ANTHROPIC_API_KEY` was added to Preview while the branch's build was
  already running. Every ask on that alias said "The assistant is
  unavailable right now" for an hour, the runtime log had nothing — the
  loop swallowed the SDK error — and the push that should have produced a
  fresh build produced no Vercel deployment at all (cause not established;
  the next push did). Read the deployment's `createdAt` against the moment
  the variable was saved before reasoning about the key's value. After
  changing a variable: push a commit or click Redeploy, then wait for the
  alias to flip to a READY build created after the save.

  Two things came out of it. The loop now logs status, error type and
  request id on an API failure (`packages/integrations/src/ask.ts`), and
  `/settings/assistant` has a **Check connection** button that asks the
  Models endpoint for the model the box runs on — the screen half of that
  log line, so an owner does not need an agent to read Vercel for them.

  And the companion, established the same evening: a browser-agent run
  that reports "finished" with ZERO requests in Vercel's runtime logs for
  the deployment never touched the app. Two such reports arrived; both
  described sessions that made no request. Group the runtime log by
  `deploymentId` for the window of the run before reading a single
  verdict, and treat "the paste came through empty" as a separate problem
  from "the run happened".
- **THE PAGE WILL TELL YOU WHICH COMMIT IT IS SERVING, AND IT IS THE ONLY
  ANSWER HERE THAT CANNOT BE STALE.** 2026-10-13. Every `<script>` Next emits
  carries a `dpl=` query parameter, and on this project **its value is the first
  32 characters of the git commit SHA**:

  ```js
  [...document.querySelectorAll('script[src*="dpl="]')]
    .map((s) => s.src.match(/dpl=([0-9a-f]{32})/)?.[1]).filter(Boolean)[0]
  ```

  | read from | `dpl=` | commit |
  | --- | --- | --- |
  | `app.cstream.ai` | `4c9a33f0e231d702288296f6a5236069` | `4c9a33f0…7c3ca878` (prod) |
  | the previous production deployment's own URL | `8ca399f67f7ba79f8fb590e1041267cb` | `8ca399f6…fa33fc66` (prod) |
  | a preview deployment's own URL | `205795e9c75a640f7796d60b1ec88d62` | `205795e9…739664e8` (preview) |

  **Why it outranks everything else this file tells you to check.** It needs no
  dashboard, no token and no MCP, so a browser tester can answer "am I on the
  new build" themselves — and `curl | grep` answers it for an agent in one
  line. An alias listing, a project's `latestDeployment` and a deployment's
  `state` are all assertions ABOUT the serving; this is the serving. The
  entries above about a cached `status` field and about green checks on a
  commit nobody asked about are the same lesson twice, and this is the first
  instrument in this section that is immune to it.

  **It was a browser tester who produced it, unprompted**, by reporting the
  `dpl=` value as circumstantial evidence while stopping at step 0 of a
  click-list. It was the fact that cracked the whole afternoon, and no API call
  anybody made that day was as decisive.

  **Put it at the top of any click-list that follows a deploy**, as one exact
  string to match rather than a sentence to compare. Telling a tester to look
  for changed wording makes them judge; telling them to match 32 hex characters
  does not, and a stale tab is then one line into the run instead of six steps
  in.

  **Two bounds, both real.** It names the COMMIT, not whether users are getting
  it — for that you still need the hostname the app actually runs on, which is
  the trap in the next paragraph. And all four samples are git-sourced
  deployments; what a CLI or file-upload deployment puts there is UNTESTED, so
  verify the mapping before trusting it on a project that deploys that way.

- **NAME THE HOSTNAME, NOT "THE CUSTOM DOMAINS" — AND PRODUCTION CAN GO
  BACKWARDS WITHOUT ANYBODY ROLLING IT BACK.** 2026-10-13, the episode the entry
  above came out of, and the fourth member of the "name the endpoint, never say
  'the database'" family alongside the two Neon projects and the three Clerk
  instances.

  Vercel's GitHub integration refused three successive merges to `main` with
  **"Deployment rate limited — retry in 24 hours"** (the Hobby daily deploy cap,
  tripped at 00:25Z), so each one landed with **no Vercel deployment at all** —
  the "a push produced no Vercel deployment" scar, three times in one evening.
  One session then made a DIRECT deployment request for the oldest of them to
  get it shipped. That was accepted while the cap was still refusing pushes, so:
  **the cap applies to the git integration, not to the API**, which is the
  escape hatch worth knowing. It also deployed a commit that two newer merges
  had already superseded, and it took the production alias — moving production
  BACK to its own parent commit for 26 minutes. Nobody rolled anything back.

  **The expensive part was a falsifier aimed at the wrong hostname.** That
  session checked whether the deployment had taken "the custom domains", found
  their `updatedAt` frozen, and reported it had NOT taken production. The
  domains it read were `cstream.ai` and `www.cstream.ai`. **The app runs on
  `app.cstream.ai`**, whose `updatedAt` had moved — and a click-through
  independently read the superseded commit off the live page thirteen minutes
  later. The reasoning was sound and the hostname was wrong, and a tester was
  sent at a build that did not exist yet.

  This project has SIX domains (`get_project` lists them) and only one of them
  is the app. So: assert the alias of the HOST you mean by name, and read the
  page's own `dpl=` as the second witness. One of those two alone is what this
  cost.

  **WHAT THE LIMIT ACTUALLY IS, measured rather than inherited.** It was first
  diagnosed in Slack as the Hobby *daily* deploy cap. It is not: only **17
  deployments existed in the 24 hours before the refusal**, and all of that
  day's nineteen sit inside a four-and-a-half-hour window, six of them in the
  hour before it. So it is a BURST limit. The account is `plan: "hobby"` with
  `concurrentBuilds: 1` and `softBlock: null` (from `get_auth_user`), and Vercel
  does not publish the threshold — so do not write a number here.

  Two consequences worth more than the diagnosis:

    - **A direct deployment request still works while pushes are being
      refused.** `create_deployment` with a `gitSource` was accepted 33 minutes
      into the refusal and went live normally. That is the way to ship a merge
      the integration has dropped, and it builds rather than promotes, so
      `check-schema.mjs` still runs.
    - **Every commit was building BOTH projects**, because neither
      `vercel.json` had an `ignoreCommand`. Over `main`'s last 30 commits, 27
      changed nothing `apps/lien-waiver` depends on — nine builds in ten spent
      rebuilding a marketing tool whose files had not moved, while the product's
      own merges were refused for going too fast. `apps/lien-waiver/vercel.json`
      now skips those; `apps/lien-waiver/lib/deployTrigger.test.ts` carries the
      reasoning, because `vercel.json` cannot hold a comment and the polarity is
      invertible in a way that fails silently.

  **`apps/web` DELIBERATELY HAS NO `ignoreCommand`, and that asymmetry is the
  point.** A skipped build leaves the previous deployment serving, so a project
  that skips can legitimately sit behind `main` — which is indistinguishable, on
  the `dpl=` check above, from the deploy failure that produced this entry. The
  saving is taken only where being a commit behind costs nothing. The test pins
  it so nobody optimises the product's deploys into that ambiguity.

- **A 503 ON A SAVE IN THE FIRST MINUTES AFTER A DEPLOY IS THE ALIAS SWAP,
  NOT YOUR CODE — AND THE WRITE STILL LANDS.** 2026-10-13, reported twice by
  browser click-throughs of the same form, each run started within minutes of
  being told the build was live.

  The shape, because it reads alarmingly: the page says **"Saved."**, the
  network panel shows the POST returning **503**, and the value is correctly
  stored — confirmed by reload every time. A tester's natural reading is "the
  UI lies about saving", which is the right worry and the wrong conclusion.

  | saves observed | result |
  | --- | --- |
  | run 1, minutes after a deploy | 2 of 2 said "Saved."; both 503; both persisted |
  | run 2, minutes after a deploy | 4 saves, 2 × 200 and 2 × 503; **all four persisted** |
  | run 3, build ~10 min old and warm | repeated saves, **no 503 at all** |

  **ELIMINATED, so nobody spends the afternoon:**
    - **Not our code throwing.** Vercel reported ZERO runtime errors across
      two separate windows covering both runs.
    - **Not the action's own request.** An `ActionResult` form awaits the
      action and branches on `result.ok` BEFORE showing success, and a thrown
      (production-redacted) error is caught into a sentence — so a failed
      action request produces an error line, not "Saved.". The data landing
      every time says the same thing from the other side.
    - **Not a lying success indicator.** Worth stating separately because it
      is what the report alleges. `openingDeduction.test.ts` pins the
      ordering: the ok check returns before the success flag is set.

  So the remaining candidate is the `router.refresh()` that follows a
  successful save, landing on a deployment whose alias has just been swapped
  onto a cold function. Its failure is invisible to the person, because the
  form already shows what they typed.

  **NOT PROVEN, and here is the bound.** The MCP's runtime logs carry no
  status codes (the tool's own CLI-fallback note says so), so they cannot
  identify which request 503'd; the Vercel CLI, which reads request logs that
  do, is not installed on this machine. The evidence is the correlation with
  deploy age plus the three eliminations above — not a log row naming the
  path. **A request log would settle it, and the dashboard's Logs tab keeps
  only the last hour**, so it has to be read while the run is fresh: press
  Save a few times, then filter `/settings` immediately and look for
  `GET /settings?_rsc=…` (the refresh) against `POST /settings` (the action).
  A fresh attempt on a warm build produced no 503 to read.

  **What reopens this:** a 503 with NO deploy in the preceding ten minutes.
  Until then, do not re-diagnose it, and do not let a click-through's "the
  page said Saved but the request failed" send you looking at the form —
  check the deployment's age first. It is also why the live-build check in
  this file's own workflow matters: telling somebody to click the moment a
  deploy lands is how you walk them into this.
- **Do not promote a preview to production.** Merge to `main` instead, so
  the build actually runs. Previews are public (no deployment protection),
  carry the branch's latest commit at a stable alias, and are what browser
  testing should point at.
- ~~Previews share PRODUCTION's database — they run on Vercel's env vars,
  so a preview reads and writes `ep-little-sea`, the real data. Browser
  testing against a preview creates real rows; use an obvious prefix and
  delete them afterwards.~~

  **STRUCK 2026-09-02. This was true until 1 Sep and it contradicted the
  three-project table 100 lines above it in this same file** — the table
  says previews run on the demo project, this paragraph said they run on
  production, and both sentences sat on `main` at once. Exactly the
  two-meanings-of-"the database" failure the table was written to end,
  reproduced inside the document that ends it.

  Previews run against the DEMO project (`ep-patient-lake`). Preview's
  `DATABASE_URL`/`DIRECT_URL` were repointed there by `344e152`, 1 Sep,
  the commit that added the table. Browser testing on a preview no longer
  creates real rows and no longer needs cleaning up — which is the point
  of the split, and was being thrown away by anyone who read this far
  down and stopped.

  **CONFIRMED 2026-09-07, and the method is the reusable part.** This
  paragraph used to end "UNVERIFIED from here: nobody on this branch can
  read Vercel's environment variables, so the last word is the Vercel
  dashboard." That is wrong twice over: the dashboard is not needed, and it
  would be the weaker evidence anyway. It says what is CONFIGURED. A build
  log says what the build RESOLVED.

  `check-schema.mjs` prints the target on every build, so the answer is one
  call to Vercel's build logs — no dashboard access, no credentials:

  | Build | `db: app queries` |
  | --- | --- |
  | preview, `claude/prova-vercel-direct-url-hg1acx` | `ep-patient-lake-afizorh1-pooler…/neondb` |
  | preview, `cyrus/permission-gates` | `ep-patient-lake-afizorh1-pooler…/neondb` |
  | production, `main` | `ep-little-sea-a6bdnaw2-pooler…/neondb` |

  Two unrelated branches and a production control, so it is not one branch
  with an odd override. Previews are on the demo project. The circumstantial
  case below held up, and is left because it is how this was reasoned about
  before anyone thought to read a build log.

  Weaker but still true: the preview arm of `apps/web/app/(app)/error.tsx`
  tells a failing preview to run the **Migrate demo database** workflow,
  which would be nonsense advice if previews read production; and
  `CHANGELOG.md` records a preview verified against `ep-patient-lake`.

  If a preview ever shows the real 14 jobs, this paragraph came back — and
  the build log, not the dashboard, is what settles it in a minute.

  The rest of this entry is history and still accurate:
  until 2026-08-28 every deployment migrated it, so a migration went live
  ON PUSH (`add_submittals` reached production from an unmerged branch).
  #18 gated that to `VERCEL_ENV=production`; #28 took it out of the build
  altogether, because that gate could not see promotion. Migrations now
  land when the PR MERGES, applied by CI.

  Three things follow. Additive migrations only unless you've pinged first
  — a drop is irreversible against real data. The `prisma migrate dev`
  reset offer appears when your branch is missing a migration the database
  already has, which is what branching off `main` while another branch's
  migration is live does — base the branch on the branch that owns the
  migration instead; whether accepting it is catastrophic or merely
  annoying depends on which host your `.env` points at, per the table
  above. And a preview of a branch adding a model runs against a database
  WITHOUT those tables, so those pages fail on the preview until it merges
  — to click through such a branch first, apply its migration to the
  target database yourself and redeploy. (`ALLOW_PREVIEW_MIGRATIONS` was
  the old escape hatch. No code reads it any more — it left with the
  build's migrate step — but corrected 2026-09-02: it is NOT gone, it is
  still sitting commented-out in `packages/db/.env.example:17`, where the
  next person setting up a laptop will find it and reasonably assume it
  does something. Setting it does nothing at all, which is the worst of
  the three possible behaviours.)
- **PREVIEW ISOLATION IS PER-RESOURCE, AND THE BLOB STORE IS NOT THE
  DATABASE.** The three-project table above isolates one resource. It says
  nothing about file storage, and "previews are isolated" is the sentence
  a reader takes away from it — which was harmless until #195 shipped
  photo upload and gave previews something to write that is not a row.

  **A Vercel Blob store is ONE store, shared by every tenant.** That is
  not incidental; it is the fact #195's own security fix rests on, and
  why a URL from the store was never proof of whose file it was.

  Diego's call, 2026-09-09: **Preview gets its own store, not
  production's** — the same reason previews left `ep-little-sea`, that
  browser testing must not write real things. Two details make sharing
  worse than it looks: #195 ships no reaper, so a failed preview upload
  strands a file nothing collects, and `isBlobStorageUrl` proves "some
  Vercel store" rather than ours.

  **Verify it the way the preview database is verified — from evidence
  the app already emits, not from the dashboard.** Every blob URL is
  built as

      `https://${storeId}.${access}.blob.vercel-storage.com/${pathname}`

  (`constructBlobUrl`, `@vercel/blob@2.8.0` `dist/chunk-YYMLUMXS.js:339`),
  so **the first label of the hostname IS the store id**. Upload one photo
  on a preview and one on production and compare that label: same means
  one shared store, different means isolated. The URL is on screen in the
  gallery; no credentials and no dashboard access are involved.

  The same store id is derivable from the token, which is what closes
  #195's open provenance item. The SDK reads `BLOB_READ_WRITE_TOKEN` as
  `token.split("_")[3]` (`:120` — i.e. `vercel_blob_rw_<storeId>_<secret>`)
  and strips a leading `store_` (`:158`). So pinning `isBlobStorageUrl` to
  OUR store is one line, needs no new secret, and gets more useful with
  two stores rather than less: each environment's own token names its own
  store, so the check follows the environment automatically.

  **THE VERCEL MCP DOES HAVE ENVIRONMENT-VARIABLE TOOLS, AS OF 2026-09-28,
  AND THIS BULLET SAID THE OPPOSITE THREE TIMES OVER.** It read: *"the
  Vercel MCP has no environment-variable tool — projects, deployments,
  build and runtime logs, deployment protection, domains and analytics,
  and nothing that reads or writes an env var (checked three times now,
  most recently 2026-09-09)"*. Nobody checked carelessly; the tool surface
  moved under a sentence that had been verified three times, which is
  exactly why it was believed.

  Six of them, read out of the tool schemas rather than from a memory of
  them:

  | tool | what it does |
  | --- | --- |
  | `filter_project_envs` | lists a project's variables; has a `decrypt` parameter |
  | `get_project_env` | its own `id` parameter says "to get the **decrypted value**" |
  | `create_project_env` / `edit_project_env` | write |
  | `get_shared_env_var` | "Retrieve the **decrypted value** of a Shared Environment Variable" |
  | `update_shared_env_variable` | writes team-level shared variables |

  **Established by use, not by reading a list.** On 2026-09-28
  `filter_project_envs` returned every variable on `prova-web` — keys,
  types, targets, ids — and `edit_project_env` WROTE a new `CRON_SECRET`,
  confirmed by `updatedAt` moving. That write is also how the two-hour
  production deploy freeze that day was cleared, so this is not a
  capability somebody went looking for.

  One thing that behaviour settles and one it does not. A `sensitive`-type
  variable comes back from the LISTING as `value: ""` — production
  `DATABASE_URL` is `sensitive`, and its value was not returned. Whether
  `get_project_env` reaches it is **UNTESTED AND DELIBERATELY SO**: testing
  it means decrypting a live database credential to satisfy curiosity, and
  the rule below has not changed. Do not run that experiment to close this
  paragraph.

  **The other half of the original bullet still stands and is the part to
  keep:** a read-write blob token is a credential, so it never travels
  through an agent channel regardless of which tool could fetch it.
  Connecting the store to an environment in the dashboard mints the
  variable itself, which is better than pasting one: nothing is copied, so
  nothing can be pasted into the wrong project.

  A useful thing learned while writing that `CRON_SECRET`: a
  `sensitive`-type variable **cannot be edited in the dashboard** — Vercel
  makes it write-once and never shows the value, so the Edit button
  refuses. `edit_project_env` patches it anyway. Delete-and-recreate is not
  required.
- **A successful write can show up as an empty list — and it was a UI bug,
  not a lost update.** Issue #61. The dead explanations, the Next source
  reading and the timed captures are in `docs/claude/empty-list-after-write.md`.

    - **Timed 2026-10-04:** the form closed at 1.25 s and the row repainted at
      3.5 s, with no reload. `ActionForm` now fires `onSuccess` only after the
      transition's re-render commits.
    - **Eliminated, do not re-check:** the connection pool, a missing
      `router.refresh()`, and missing revalidation. `revalidatePath` plus a
      returned value re-renders by itself. Do NOT re-run the capture.
    - **A report of this shape needs a timestamp before it counts as
      evidence.**
    - **Read the test next to the code before believing a doc-derived
      inference about it.** `components/actionForm.test.ts` already answered
      the wrong diagnosis made here.
    - **A page that fails after a commit invites a second click, and no
      create action is idempotent.** Create buttons disable while in flight.

- **"Cancel first" is not the rule for an armed delete — "Cancel takes the
  pixel Delete vacated" is, and which end that is depends on the cluster's
  alignment.** Issue #152's rule 2 says the confirm button must not occupy
  the position the delete button just vacated, so a hurried second click
  costs a click rather than the record. The mitigation everyone reaches for
  is "render Cancel first". That is correct in exactly one geometry.

  Measured in real Chromium (Playwright, the actual class strings, a real
  box model — a DOM-only test environment like happy-dom or jsdom does no
  layout and returns zeros from `getBoundingClientRect`, so no unit test in
  this repo can see any of this):

  | cluster | unarmed | armed `[Cancel][Confirm]` | overlap |
  | --- | --- | --- | --- |
  | right-pinned (`justify-between` parent + `shrink-0`) | `[Edit][Delete]` | Confirm is last | **60.7px, 100%** |
  | left, one ordinary action | `[Edit][Delete]` | | 44.0px, 72% |
  | left, two ordinary actions (`ApprenticeshipRowActions`) | `[Record][Edit][Remove]` | | 0px |

  The reference row this rule was written from is the third line — the one
  case where it happens to work — which is why the wrong version of it read
  as correct for a week.

  **In a right-pinned cluster the LAST control keeps its position**, so
  Cancel goes last and the confirm sits clear of it. In a left-aligned
  cluster the FIRST slot is the stable one, so Cancel goes first. Same rule,
  opposite order. State it as "Cancel inherits the Delete pixel" and it
  survives the translation; state it as "Cancel first" and it does not.

  `SalesActivityRow`, `SalesOpportunityRow` and `SalesLeadRow` were checked
  by measurement rather than by reading: all three already had the ORDER
  right and only rule 1 (hide every ordinary action, not just the one
  somebody remembered) was broken on the first two.

  **ON A PHONE THE RULE HAS NO X AXIS TO WORK ON, AND THAT IS THE HALF THIS
  ENTRY WAS MISSING.** Added 2026-09-08 from issue #184. The table above is
  all desktop. Below 640px the field rows STACK (`flex flex-col …
  sm:flex-row`, #89), the cluster stops being right-pinned, and `RowActions`
  hides the ordinary actions — so the armed pair reflows to the LEFT EDGE
  while the Delete it replaced sat to the right of an "Edit" that is now
  gone. Neither end is stable, because nothing is at the delete's pixel any
  more: `EquipmentRow` at 375px measured 86% confirm overlap as
  [Confirm][Cancel] and 75% as [Cancel][Confirm]. No value of `pinned` could
  reach it, and two plausible fixes were measured and rejected — reserving
  the hidden actions' width INVERTS (the restored slot is last at 1100px and
  first at 375px, so one prop would need two contradictory values), and
  right-aligning the stacked cluster works only by permanently moving the
  UNARMED row's buttons on five phone screens.

  So the rule keeps its shape and changes its axis: below `sm` the armed pair
  is a full-width COLUMN with **Cancel on top**, which is "Cancel inherits the
  delete pixel" read vertically. `ConfirmDelete` adds it itself
  (`max-sm:flex-col` / `max-sm:flex-col-reverse`, `contents` at >=640 so the
  desktop rects are byte-identical), so no caller can get it wrong. Measured
  0% overlap and 100% Cancel cover on eight rows at 639 and 375. `pinned` is
  now purely a desktop decision, which is why `PINNED_EXCEPTIONS` is empty —
  the three rows that were in it had no value that was right at both widths,
  and that conflict no longer exists.

  It costs 56px of row height while armed and makes both buttons full width,
  at phone widths only.

  **AND A THIRD AXIS NOBODY HAD MEASURED: THE LABEL'S OWN WIDTH.** Added
  2026-09-14. Both halves above are about ORDER — which end of the cluster
  Cancel goes to. Order is not the only way the confirm ends up under the
  delete's pixel, and the other way passes every check in this repo.

  A LONG delete label makes the armed pair NARROWER than the button it
  replaces, so the pair stops covering the same span and the confirm drifts
  under where the label used to be. #265 shipped `label="Remove this
  estimate"` on `ConfirmDeleteButton` — 147px against the 71px of an
  ordinary "Remove". Probed in the running app: armed, the element at the
  exact centre of where that button had been was **"Remove it"**, the
  confirm. The order was right the whole time (Cancel last, right-pinned,
  exactly as this entry says), which is precisely why nothing caught it.

  | label | delete width | at its old centre, once armed |
  | --- | --- | --- |
  | `Remove this estimate` | 147px | **Remove it** — the confirm |
  | `Remove` | 71px | Cancel |

  So the rule needs a second sentence: **Cancel inherits the delete pixel,
  and the delete has to be narrow enough for the pair to reach it.** The
  practical form is a short label — what is being removed belongs in
  `describe` (which is a tooltip and costs no width) and in the row's own
  text, never in the button.

  `rowActionsCensus.test.ts` caps a delete label at 12 characters. That is a
  character count standing in for a pixel width and the test says so: nothing
  here can measure layout — happy-dom returns zeros from
  `getBoundingClientRect`, which is why every number in this entry comes from
  real Chromium. The ceiling is the longest label the app ACTUALLY uses
  rather than a round number (61 sites; "Delete draft" at 12 is the longest),
  so it cannot quietly grow to admit the next offender.

- **`pnpm build` AND THE DEV SERVER SHARE `.next`, AND THE BUILD WINS.**
  Both write `apps/web/.next`. Run a build while `next dev` is serving and
  the dev server starts throwing `Cannot find module …
  segment-explorer-node.js#SegmentViewNode` and
  `__webpack_modules__[moduleId] is not a function` on every route — a 500
  that looks like the branch is broken and is not. It cost a debugging
  detour on 2026-09-14, and it fires on the ordinary workflow of verifying a
  change and then clicking it.

  The fix is `rm -rf apps/web/.next` and restart the dev server. There is
  nothing to repair in the diff. If a dev server that was working starts
  500ing on EVERY route right after a `build`, `test` or `preflight` run,
  this is it — check for that module name in the server log before reading
  any code.

- **A watcher whose needle is ALREADY ON THE PAGE cannot fail, and it will
  report a fast, confident, wrong number.** Born from the #61 capture
  above, and the same shape as every other vacuous test in this file — it
  just wears a stopwatch instead of an assertion.

  The timing instrument was `document.body.innerText.includes(needle)`,
  polled every 100ms from the click, to measure when a newly saved row
  appears. It fired at 101ms — the first tick — on BOTH runs, for two
  different reasons:

    - on `/settings`, a row containing the needle string was ALREADY THERE
      when the run began (left by another agent session writing to the same
      account — see the concurrent-writes note below);
    - on `/jobs/[id]`, the takeoff form renders a live "what will be added"
      preview AS YOU TYPE, so the label was in page text before Save was
      ever clicked.

  Both would have returned 101ms if the save had failed outright. The
  browser tester caught it, said so before presenting any figure, ran the
  prescribed version anyway for the record, and built a second signal that
  can only change on a real save — an occurrence COUNT (1 -> 2), and the
  disappearance of "No line items yet".

  **The rule: a timing signal must be something that cannot be true
  before the event.** A count crossing a threshold, an empty-state string
  disappearing, an element with a server-generated id appearing. Never a
  substring that a form preview, a placeholder, or a pre-existing row
  could already be rendering.

  **And the reason this belongs in this file rather than in the issue:
  earlier timings of #61 may be artefacts of exactly this.** Anyone who
  measured the takeoff form as the fast control was measuring its preview.
  That makes the control look instant and the suspect look worse by
  comparison than it is.

  Two smaller lessons from the same run, both cheap: `content-length` is
  null on these responses (brotli-streamed), so sizes must come from
  Resource Timing's `encodedBodySize`/`decodedBodySize`, not headers. And
  an instrumentation patch installed via the console dies on a full page
  reload — take every reading first, do the reload checks last, and move
  between pages by in-app links only.

- **MORE THAN ONE AGENT SESSION WRITES TO PRODUCTION, AND ONE OF THEM IS
  NOT ANNOUNCING IT.** Three stray rows appeared on `ep-little-sea` on 4-5
  Sep 2026. The sightings, what was ruled out and what is still open are in
  `docs/claude/production-writers.md`; read it before looking for the cause.

    - **A measurement taken on this account is not taken on a quiet one.**
      Before timing or counting anything on production, record the starting
      state of the rows you are about to measure, and say so in the report.
    - **If you are the session writing:** demo project or a scratch database,
      never `ep-little-sea`. If a production write is genuinely unavoidable,
      post it in Slack BEFORE the write and delete it in the same sitting.
    - **The cause is unidentified.** The demonstrated route is a browser
      session against `app.cstream.ai`, which needs no local connection
      string. The Vercel MCP stays UNKNOWN, not cleared: an unknown does not
      belong in a list of eliminations.
    - **An agent copying `.env` files between worktrees is worth a Slack
      line.** Check for a connection string INSIDE each session, reporting
      the HOST only and never the string. Local peer sessions can be asked
      through `ListAgents` and `SendMessage`; cloud sessions cannot.

- **`--shadow-database-url` IS A RESET COMMAND WEARING A DIAGNOSTIC'S
  NAME, and it was handed a real database.** 2026-09-18, and the most
  expensive minute of the day: an agent generating migration SQL ran
  `prisma migrate diff --shadow-database-url <DIRECT_URL from
  packages/db/.env>`. That URL was ep-icy-hat — Cyrus's dev database, the
  one he was walking the app against. Prisma DROPS AND RECREATES a shadow
  database before replaying migrations into it; that is documented
  behaviour, not a bug. Every company, job and test record went, and
  `_prisma_migrations` with them — which is why the NEXT symptom was other
  processes failing with P3005 "database schema is not empty" and a
  `to_regclass('_prisma_migrations')` of null. Recovery was Neon's
  point-in-time restore to the minute before.

  Three rules fall out, none optional:

    - A schema-to-schema diff (`--from-schema-datamodel` /
      `--to-schema-datamodel`) opens NO database connection and is the
      right way to generate migration SQL. It never needs a shadow URL.
    - If a command genuinely needs a shadow database, the shadow is a
      THROWAWAY LOCAL one — never a URL copied out of any `.env`. A
      connection string's presence in an env file is a statement that
      something real lives there, which is precisely what disqualifies it.
    - The db suite (`vitest.db.config.mts`) had SAID "run against a
      SCRATCH database — never a real one" since it was written, and a
      comment is not a guard. It now refuses to start against anything
      that is not localhost or a unix socket: `vitest.db.setup.mts`,
      backed by `scratchProblem()` in
      `packages/db/scripts/connection-target.mjs`, tested in
      `apps/web/lib/db-target.test.ts` against the real endpoints. There
      is deliberately no env-var escape hatch.

- **`./scripts/preflight.sh` used to die on its first line inside a git
  worktree.** It ran `rm -f .git/index.lock`, but in a worktree `.git` is
  a FILE, not a directory — so that is `ENOTDIR`, which `rm -f` does NOT
  suppress, and `set -e` killed the script. The entire output was
  `rm: .git/index.lock: Not a directory`. Agents work in worktrees, which
  is why no agent branch was ever preflighted.

  The fix is `rm -f "$(git rev-parse --git-path index.lock)"`, placed
  BELOW the `cd` to the repo root so the lock cleared is the repo's rather
  than whatever directory you were standing in. Two branches found this
  independently on the same day and wrote the same fix, which is its own
  small signal about how often the worktree path is exercised.

  If you are on a branch that predates that fix and preflight dies with
  that one line, it is this — run `typecheck`, `lint`, `test` and `build`
  individually rather than hunting it.

- **A DROP AND THE DEPLOY THAT STOPS READING THE COLUMN DO NOT LAND
  TOGETHER, AND THE GAP IS A PRODUCTION OUTAGE.** 2026-09-20, #378. The
  migration dropped `PunchListItem.isDone` and `completedAt`; the code that
  had stopped reading them shipped in the same PR. Both true, and still
  broken: `migrate.yml` fires on merge and finishes in seconds, while
  Vercel is still BUILDING the commit that removes the reads. For about two
  and a half minutes the LIVE build was the old one, selecting a column
  that no longer existed.

  Measured rather than feared, which is the only reason the size of it is
  known: columns dropped 07:44:33Z, deploy READY ~07:46, and Vercel's
  runtime errors for that window are exactly one —
  `P2022: The column PunchListItem.isDone does not exist`, route
  `/punch-lists`, one user, and the user was the agent that pushed it. A
  quiet Sunday morning is the whole reason this cost nothing.

  **The rule this file already had did not cover it.** "Additive
  migrations only unless you've pinged first" reads as being about losing
  DATA — and the ping happened, and no data was lost. The hazard is the
  window, not the drop: an additive migration is invisible to the old
  build, and a destructive one is fatal to it. Pinging does not shorten the
  window by a second.

  So, for any column, table or enum value the running code reads:

    1. **PR one takes the reads away** and ships. The column stays.
    2. **PR two drops it**, once the deploy that stopped reading it is
       live. Nothing in the gap can break, because nothing reads it.

  Two PRs, and the second one is three lines. That ordering — expand, then
  contract — is what makes `preflight.sh`'s destructive check survivable
  advice rather than a speed bump: it refuses the push and says to ping,
  which is right, but the answer to the ping is "split it", not "override
  it and merge faster".

  `PREFLIGHT_ALLOW_DESTRUCTIVE=1` remains the deliberate override and is
  still the right escape hatch for the contract step, when the column is
  genuinely unread by the deployed build. It was used here for a drop whose
  reads were removed in the same commit, which is exactly the case it
  should not have been used for.

- **A fresh worktree has NO `node_modules`, and that is how unverified
  work piles up.** `pnpm install --frozen-lockfile` takes seconds and
  nothing works without it — so an agent that skips it cannot typecheck,
  test or build, and reports "done" on the strength of having written
  plausible code. Three WIP branches were found on 2026-09-03 in exactly
  that state; every one of them failed `typecheck` the moment deps
  existed. `pnpm build` additionally needs `.env` (Clerk key and
  `DATABASE_URL`); copy `apps/web/.env` and `packages/db/.env` from the
  main checkout, and a build failing ONLY on `Missing publishableKey` or
  `[db] DATABASE_URL is not set` is environmental, not your diff.

  **AND IN A CLOUD AGENT CONTAINER THAT COMMAND DOES NOT COMPLETE AT ALL,
  WHICH IS WORSE THAN IT SOUNDS.** Verified 2026-10-04: `pnpm install
  --frozen-lockfile` dies on `ERR_PNPM_FETCH_403` fetching
  `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` — the `xlsx`
  dependency, which is pinned to a tarball URL rather than to the npm
  registry, and that host is not on the egress allowlist. It aborts after
  about 931 of 1242 packages with **nothing linked into
  `apps/web/node_modules`**, so 258 of 555 test files fail to load on
  missing packages and `tsc` reports ~22,000 errors that are all
  resolution noise.
  
  The sentence above — "takes seconds and nothing works without it" — is
  still right about the consequence and wrong about the cause, and an agent
  that reads it will run the command, watch it print progress, and carry on
  believing it has dependencies. **Piping it to `tail` or `head` reports
  exit 0**, because the pipe's exit status is `tail`'s; that is the
  `set -o pipefail` scar in the Git rules arriving in a new place, and it
  is how this was nearly missed twice in one session.

  **What DOES work, and it is enough for the db suite.** The blocked
  dependency belongs to `apps/web`, so the db package is untouched by it:

      pnpm install --frozen-lockfile --filter @prova/db     # completes, ~28s

  That generates the Prisma client and fetches the query engine. Postgres 16
  is already installed at `/usr/lib/postgresql/16/bin` (not on `PATH`); it
  refuses to run as root, and the scratchpad's parents are not traversable
  by the `postgres` user, so the data directory has to go somewhere that
  user owns. `prisma migrate deploy` then applies every migration, so the
  scratch database is real and current. The two resolutions that are still
  missing — `@prova/db` (the workspace link never got made) and `next/*` —
  are aliases in a LOCAL vitest config: the package source for the first,
  small stubs for `next/headers` and `next/navigation`. Nothing in the repo
  changes and CI resolves the real modules.

  `lib/actions/subListing.dbtest.ts` was written and run that way, and it
  found a defect on its first run — in the harness, not the code:
  `assertSalesAccess` reads `isProvaOperator` off the CONTEXT, so a mocked
  `requireCompanyContext` without it fails six cases with "Not found" while
  the company row in the database has the flag set.

  **The limit is as important as the recipe:** this reaches the DB suite. It
  does not reach the signed-in e2e suite, which still needs a browser the
  egress proxy will not let near Clerk's FAPI host — the paragraph near the
  top of this file about `pnpm test:e2e` stands unchanged.

  **THE 403 IS GONE AND THE INSTALL COMPLETES — 2026-10-05, and the whole
  entry above is now about a container that no longer exists.** Measured
  after a container restart wiped `node_modules`, so this was not a curiosity:
  the harness had to be rebuilt before anything could be re-run.

  | | measured 2026-10-05 21:55Z |
  | --- | --- |
  | `GET https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` | **HTTP 200**, 2,409,319 bytes |
  | those bytes | a real gzip tarball, 26 entries, `package/dist/LICENSE` first |
  | `pnpm install --frozen-lockfile` (repo root) | **exit 0, "Done in 31.9s"** |
  | `apps/web/node_modules` | populated, 21 entries — not empty |
  | Prisma client | generated by the `packages/db` postinstall |

  So the `--filter @prova/db` recipe above is no longer the ceiling: the
  full install works, and with it the real `vitest` and a real `tsc`.

  **What this does NOT establish, because the temptation is to write the
  stronger sentence.** Not WHY the host answers now — an allowlist change
  and a transient 403 on 4 October are both consistent with it, and nothing
  here distinguishes them. Not that a COLD pnpm store completes: the store
  at `/root/.local/share/pnpm/store/v10` predates today and was not cleared,
  because clearing it to satisfy curiosity would have destroyed the working
  install this run needed. The reachable host is the part that is settled,
  and it is the part the old entry named as the cause.

  **One thing the old recipe gets right and is worth keeping, plus the half
  it is missing.** It says the Postgres data directory "has to go somewhere
  that user owns" because the scratchpad's parents are not traversable by
  `postgres`. True — and the sharper version is that a cluster under the
  scratchpad does not SURVIVE a restart: `/tmp/claude-0` comes back
  `drwx------`, so `initdb` fails with `could not access directory` on a
  path that worked an hour earlier, naming the data directory rather than
  the parent that actually refused. Put the cluster in
  `/var/lib/postgresql/<name>` and the restart costs one `initdb` plus one
  `prisma migrate deploy`.

  **CORRECTED 2026-10-06 BY FOLLOWING IT, four hours after it was written —
  the last sentence is wrong in both halves, and the recipe as given FAILS
  on the second restart.** What actually happened on the next restart:

  | the paragraph above says | measured |
  | --- | --- |
  | the restart costs one `initdb` | **none.** `/var/lib/postgresql` survived with its data and `prova_scratch` intact |
  | …plus one `prisma migrate deploy` | that part holds — it applied only the one new migration |
  | (silent on this) | `pg_ctl` **refused to start at all** |

  Two things it does not mention and both are required. `postgres` rejects a
  data directory that is not `u=rwx` (0700) or `u=rwx,g=rx` (0750) — and the
  setup script that produced this entry ran `chmod 755` on it, which is
  `o=rx` and therefore refused. That was invisible the first time because
  `initdb` CREATES the directory 0700 and overwrote the 755; on a second run
  the directory already exists, so the `chmod` is the last word and the
  server dies with `data directory "…" has invalid permissions`. And the
  **stale `postmaster.pid` from the dead container must be deleted** — it
  names a pid that no longer exists.

  So: `chmod 700`, `rm -f <dir>/postmaster.pid`, then `pg_ctl start`, and
  skip `initdb` when `PG_VERSION` is already there.

  **The shape is the reason this is written down rather than quietly fixed in
  a script.** The entry was four hours old, written from a measurement that
  was real, and it broke the first person who followed it — because the
  measurement was taken on a FIRST run and written up as a property of
  restarts. `pg_ctl` names the cause exactly in its log and says nothing on
  stdout beyond "could not start server. Examine the log output", so the fix
  is one `tail` away and the temptation is to guess instead.

  **The limit that has NOT moved is the one that matters most:** this still
  does not reach the signed-in e2e suite. That needs Clerk's `sk_test_`
  secret, which is a credential and does not travel through an agent
  channel — see the Turnstile paragraph further down, which establishes that
  the gate was never the network.

- **`tsc --noEmit` FROM THE REPO ROOT COMPILES NOTHING AND LOOKS LIKE A
  PASS.** 2026-10-04, and it is the `gh pr checks` scar wearing the
  toolchain's clothes: not a wrong answer, an answer about nothing.

  There is no `tsconfig.json` at the repo root — only `tsconfig.base.json`.
  So a bare `tsc --noEmit` there exits on **TS5081, "Cannot find a
  tsconfig.json file at the current directory"**, and an agent that pipes
  the output through `grep <my file>` sees an empty result and reads it as
  clean. It is clean the way an unopened book has no typos.

  Proved by the only method that settles it, which is the transferable part:
  **inject a deliberate type error and require the checker to report it.**

  | invocation | injected `const x: number = "s"` in `parse.ts` |
  | --- | --- |
  | `tsc --noEmit` from `/home/user/prova` | **0 lines. Silent.** |
  | `tsc -p tsconfig.json --noEmit` from `apps/web` | `parse.ts(391,9): error TS2322` |

  The right invocation is the project one, and in a container without
  `node_modules` it emits ~22,500 lines of missing-module cascade — so the
  filter stays necessary, and the count of lines naming your file is what
  tells you the file was compiled at all. Empty filter plus a count of
  ZERO is the vacuous case; empty filter plus a non-zero count is a real
  pass. On this branch that was 18 lines, every one TS2307/TS7006/TS7031
  from the unlinked `react`/`next`/`@prova/db` types.

  Same family as the entries below and above it — the census with the
  wrong scope, the watcher whose needle was already on the page, the
  review that counted a dead agent as a refutation. **Ask what set the
  check can SEE before reading what it found**, and for a checker that
  means proving it can still fail.

  **AND THE READING RULE IN THAT PARAGRAPH INVERTS ONCE THE INSTALL WORKS,
  WHICH IS NOW — 2026-10-05.** The entry above tells you that "empty filter
  plus a count of ZERO is the vacuous case". That was sound advice in a
  container whose `node_modules` was empty, where zero lines could only mean
  the compiler had not run. With dependencies installed it says the opposite
  of the truth: a clean project typecheck emits **nothing at all**, and an
  agent following the sentence would read a genuine pass as vacuous and go
  looking for a broken invocation.

  | `tsc -p tsconfig.json --noEmit` from `apps/web` | lines | exit |
  | --- | --- | --- |
  | no `node_modules` (4 Oct) | ~22,500 cascade, 18 naming the file | non-zero |
  | `node_modules` installed (5 Oct) | **0** | **0** |
  | the same, with `const __control: number = "not a number"` appended to `lib/sub-listing/signals.ts` | `signals.ts(440,7): error TS2322` | non-zero |

  **So the line count was never the signal — the control was.** The third
  row is the only one that makes the second readable, and it is the part of
  the original entry that survives unchanged: *inject a deliberate type
  error and require the checker to report it.* The filter and the count were
  scaffolding around one broken container, and they dated in a day; the
  control is what settled TS5081 on 4 October and it is what settles a
  silent zero today, in either direction.

  Read the count against the environment you are in, not against this file:
  deps missing means a cascade and the filter is how you read it, deps
  present means zero and the control is how you trust it. Nothing in the
  output tells you which container you are in, which is exactly why the
  reflex has to be the mutation rather than the number.

- **"Written, documented, and never called" is a recurring shape here,
  not a one-off.** Three live instances found in a single day: 161
  `.dbtest.ts` tests no runner referenced; an `acknowledgedSeverity`
  column that nothing selected and nothing wrote; and a `factDigest`
  helper whose call site still used the unbounded value it was written to
  replace. Each one typechecked and tested GREEN throughout, because
  nothing referenced the dead code. So when reviewing a fix, grep for the
  new symbol and confirm something CALLS it — the tests passing is not
  that evidence, and neither is the diff looking complete.

- **A verifier that cannot distinguish "refuted" from "never ran" reports
  clean and means nothing.** Diego, 2026-09-07, on #195: a multi-agent
  review of the diff came back "0 confirmed, 10 refuted". Every one of the
  verify agents had died on a session limit before writing a verdict, and
  the post-processing counted "no verdict" as "refuted". Three of the seven
  review dimensions had never run at all. Cyrus hit the same shape the same
  day, from the other direction — a workflow scoring branches "contested"
  with `refutedBy: 0/0`, because a dead agent and a refutation look
  identical to a counter.

  Same family as the `gh pr checks` scar (green about a commit nobody
  asked about), the vacuous watcher above (fired on a needle already on the
  page), and the census that a comment quoting its own pattern disarmed
  (#185): the check was not lying, it was answering a question nobody
  asked. The rule for anything that aggregates verdicts — a review
  workflow, a mutation run, a click-list tally: **absence of a failure is
  not a pass.** Count the verdicts that were actually RETURNED and require
  that number to equal the number requested before reading any of them;
  a missing verdict is its own failure state and must be reported as one,
  never folded into "refuted", "passed" or "clean". If a tool reports
  totals, ask it for the per-item verdicts and count them yourself.

- **A GUARD THAT PARSES SQL BY REGEX IS ONE LINE BREAK FROM SEEING
  NOTHING, AND IT GOES GREEN WHEN IT DOES.** 2026-09-09, and the newest
  member of the family directly above.

  `apps/web/lib/scratch-cleanup-order.test.ts` exists so that adding a
  model with a required `jobId` fails on a laptop in a second instead of
  failing on somebody's database halfway through a cleanup. It derives the
  blocking foreign keys from the migration SQL, which is the right source
  — the database enforces what the migrations wrote, not what the schema
  file reads like. Its pattern spelled every gap in `ALTER TABLE … ADD
  CONSTRAINT … FOREIGN KEY … ON DELETE …` as ONE LITERAL SPACE, which was
  invisibly fine while every migration was Prisma-generated: Prisma emits
  that statement on a single line, and 180 of them matched.

  #224's migration was written by hand and wrapped after the constraint
  name. The pattern skipped it. The set came back 180 instead of 181, the
  one missing entry was `InvoiceCounter.jobId -> Job RESTRICT` — a brand
  new blocker on `Job`, exactly what the file is for — and all thirteen
  tests passed. Both cleanup scripts shipped unable to delete a job that
  had ever been invoiced, with the guard green the whole way.

  Two fixes, and the second is the transferable one. The pattern now uses
  `\s+` so SQL formatting stops being load-bearing. And the file counts
  the literal string `FOREIGN KEY` across the migrations INDEPENDENTLY of
  the pattern and requires the parse to return exactly that many — so the
  next formatting surprise fails with "the migrations declare 181 foreign
  keys and this file parsed 180" instead of quietly shrinking the set.
  Both were mutation-tested by restoring the old pattern and watching the
  count test go red.

  **The general rule, because this will not be the last parser here: a
  check that DERIVES its input has two failure modes, not one.** It can
  get the answer wrong, and it can get an empty question. Only the first
  one looks like a failure. Anything that greps, matches or scrapes a set
  it then reasons about must assert the SIZE of that set against a source
  that cannot drift with it — otherwise a pattern matching nothing at all
  passes every downstream assertion, since nothing is ever missing from an
  empty list and nothing is ever out of order in it.

- **AND THE OTHER HALF OF THAT RULE: A CENSUS CAN HAVE THE RIGHT PATTERN
  AND THE WRONG SCOPE, AND NO SIZE ASSERTION CAN SEE IT.** 2026-09-16,
  and it is the entry directly above arriving from the side nobody had
  guarded.

  `packages/ui/src/Button.tsx` shipped `bg-brand text-white
  hover:bg-blue-700` — white on the founder-approved yellow at **1.53:1**,
  on the shared primary button that nine pages import, including the
  GC-facing portal. `apps/web/tailwind.config.ts` says "Never put white
  text on this" three lines above the token.

  `theme-contrast.test.ts` has a census written for precisely this
  defect, and it was green the entire time. Its pattern was fine. Its
  size assertion (`found.length >= 6`) was fine and passed honestly on
  the ~20 in-app brand buttons. It resolved its scan root as `new URL("..",
  import.meta.url)` — `apps/web` — and `packages/ui` is not under it, so
  **the one offending file in the repo was never a candidate.**

  That is why the size assertion could not help. It answers "did the
  pattern stop matching", and the pattern matched plenty. It cannot
  answer "am I looking everywhere the answer could be", because a file
  outside the walk is not a small set — it is not in the set at all.
  **Nothing is ever missing from a directory you do not walk.**

  So a deriving check needs its SCOPE pinned to a source that cannot
  drift with it, exactly as the entry above pins the size. Here that
  source already existed: Tailwind's `content` globs are the definition
  of which files' classes reach the app, so the census derives its roots
  from them, asserts one root per glob, and asserts each root exists — a
  glob resolving to nothing now fails loudly instead of silently
  shrinking the scanned set. Adding a workspace package to `content`
  extends the census with no edit to the test.

  Proved by mutation rather than argued, and the third row is the one
  that matters — it reproduces the world as it shipped:

  | | Button | census scope | result |
  | --- | --- | --- | --- |
  | M1 | real bug | from `content` | RED, names the file |
  | M2 | fixed | old `appDir` | green (no offender to find) |
  | M3 | real bug | old `appDir` | **green — 20 passed** |

  The generalisation for the next census in this repo: ask what set the
  check is REASONING about, then ask separately what set it can SEE.
  Every guard here asserts the first. This is the first one to assert the
  second.

  **AND THE THIRD MEMBER OF THAT FAMILY, 2026-09-26: A GUARD THAT A LIST
  IS COMPLETE CANNOT NOTICE A SECOND LIST.** Same shape one step further
  out, and found by mutation rather than by thinking — which is the only
  reason it is written down instead of shipped.

  `CostCategory` and the bid recap's rates each had one canonical list and
  several hand-written copies. #526 collapsed them and added a regression
  pinning that the canonical list is complete. Then the mutation for it —
  restoring the local ten-name rate array in `lib/ask/handlers.ts`, the
  exact code that had Ask reporting a bid **$1,732.50 under** the Estimate
  screen — came back **GREEN. Every test in the repo passed**, including
  the one written that hour for precisely this defect.

  It had to. A completeness test proves the SHARED list has every member;
  it cannot see a consumer that has stopped reading it. *Nothing is ever
  missing from a list nobody imports* — the same sentence as the entry
  above, with "directory you do not walk" swapped out.

  The census that does work asks the other question: not "is the list
  complete" but "is there a second one". Here the discriminator was free —
  a rate key written as a STRING LITERAL is the signature of a hand-rolled
  list, because the legitimate consumers use those names as object KEYS,
  which are identifiers and do not match. It found **four more** lists
  nobody had looked for, and one was a live hole in the PR that added the
  census: the COMPANY defaults form had no equipment field at all, so that
  rate was storable, parseable and impossible to type in.

  So, for any value that has a canonical list: write BOTH guards. One that
  the list is complete, one that it is the only one. Neither implies the
  other, and only the second survives somebody helpfully inlining a copy.

  A second, smaller trap came out of the same fix, and the measured form
  of it is narrower than the one first written here: **two Tailwind
  utilities of the same property in one class string resolve by
  STYLESHEET order, not by which is written last in the string.** Tailwind
  emits font weights in ascending scale order — measured in this build,
  `.font-medium` at char 21611 and `.font-semibold` at 21669 — so a
  heavier weight appended after a lighter one DOES win, and the reverse
  silently does not. So `base`'s `font-medium` plus a variant's
  `font-semibold` would in fact have rendered correctly, and a variant
  needing `font-medium` over a `font-semibold` base would have failed with
  nothing to say why.

  Put the weight on each variant and none on the shared `base`. That is
  not a workaround for the ordering, it removes the dependency on it —
  which is the only version that stays true when someone adds a `light`
  variant.

- **A #418 HYDRATION MISMATCH "ON SEVENTEEN PAGES" IS ONE DEFECT IN THE
  SIGNED-IN SHELL, FIRING ON ABOUT ONE PAGE LOAD IN THREE — AND IT IS NOT A
  DATE.** The full investigation, every measurement and every elimination is
  in `docs/claude/hydration-418.md`. Read it before doing any of this again;
  each elimination there is an afternoon.

    - **The list of URLs is the race's dice, not a location.** Which pages
      step 11 prints changes every run. A list of one page does not mean
      something on that page.
    - **`args[]=HTML` means an ELEMENT-level disagreement.** A date, currency
      or locale value is a TEXT mismatch and produces the other word. Check
      the `args[]` before theorising.
    - **It is measuring a race, so one green run is one sample.** Two
      consecutive clean runs is the weakest claim worth making. A residual
      remains; two fixes reduced it and neither removed it.
    - **Pair a shell region with its widget inside
      `components/AppChrome.tsx`**, so the element never crosses the RSC
      boundary as `children`. **Every Clerk UI component renders inside
      `<AfterMount>`**, enforced by `components/clerkMountGate.test.ts`, with
      `/sign-in` and `/sign-up` the two named exemptions.
    - **A `B:`/`S:` pair is not evidence of suspension.** React outlines a
      boundary just for being big, and the sidebar always is.
    - **The dev-mode instrument is exhausted:** a development build does not
      reproduce the residual, so it cannot name the element. Do not spend a
      run on it. A dev run is still worth doing occasionally, because it
      reports defects a production build strips, such as missing `key`
      warnings.
    - **`e2e-public` proves nothing here:** it calls `expectHealthy` without a
      monitor, so it never reads `pageerror`.
    - **`next dev` dies after about ten compiled routes.** Four routes per dev
      server, one worker, a fresh server per batch.

- **A REAL BROWSER CAN DRIVE THE PREVIEW FROM AN AGENT CONTAINER. THE ONE
  THING STOPPING IT WAS A CA, AND THE PROXY'S OWN README SAYS THAT IS ALREADY
  HANDLED.** 2026-10-04. Worth as much as any bug in this file: it moves
  "nothing here can click the app" from true to false.

  Three claims checked rather than inherited, and two were stale:

  | claim | measured 2026-10-04 |
  | --- | --- |
  | the preview host is denied like production | **200.** Reachable |
  | Clerk's FAPI host is denied | **400** — a real Clerk response, not a denial |
  | `cdn.playwright.dev` is needed | not needed; Chromium is pre-installed at `/opt/pw-browsers` and Playwright 1.63.0 is in the root store |

  **What actually blocked it was TLS trust, and the symptom names nothing
  useful.** Every navigation failed `ERR_CERT_AUTHORITY_INVALID`, because the
  agent proxy re-terminates TLS and Chromium on Linux reads the NSS store
  rather than the system one. `/root/.ccr/README.md` lists "the browser NSS
  store" among the trust accommodations "already set up". It is not: the db at
  `~/.pki/nssdb` was created EMPTY by my own first Chromium launch, timestamped
  to the minute. The proxy CA sits in `/usr/local/share/ca-certificates/`, where
  Chromium never looks.

  The fix, and it needs no privilege beyond apt:

      apt-get install -y libnss3-tools          # certutil is not in the image
      # split each /usr/local/share/ca-certificates/ccr-agent-proxy*.crt into
      # single certs, then for each one:
      certutil -d "sql:$HOME/.pki/nssdb" -A -t "C,," -n <name> -i <cert.pem>

  Then launch `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` through
  playwright-core with `--no-sandbox`. **Do NOT reach for
  `ignoreHTTPSErrors` or `--ignore-certificate-errors`** — that is disabling
  verification, which the proxy README forbids in as many words, and the
  supported fix is four lines.

  **What is STILL blocked, and the reason is newly specific.** The signed-in
  walk, because the Clerk sign-up form carries **Cloudflare Turnstile**
  (`cf-turnstile-response` appears in the DOM after submit) and marks
  `username` and `phoneNumber` required. Clerk's own answer to bot protection
  in tests is a Testing Token, which is minted with the SECRET key — and
  `sk_test_` is a credential that does not travel through an agent channel.
  So the gate is not the network and never was: it is that CI's `e2e` job holds
  `E2E_CLERK_SECRET_KEY` and this container does not. Defeating the bot check
  is not an option; the routes are either walked by CI, by a laptop, or by this
  container once that secret is set as an environment variable.

  What this DOES buy, and it is the first of its kind here: every public route
  verified in a real browser at 375 and 1280 — hydrated, no `pageerror`, no
  console error, no horizontal scroll — and `/sales` confirmed to redirect to
  `/sign-in?redirect_url=…` rather than 404, which a `curl` without redirects
  had made look like a missing route.

  **And the instrument lied first, which is the lesson inside the lesson.** The
  walk's boundary detector matched `/went wrong/` over body text, and flagged
  the landing page at both widths — because its marketing copy reads "Most subs
  find out a job **went wrong** when it is finished." A detector whose needle is
  already on the page, written on the same day as the entry below about exactly
  that, by the same author. Anchor it on the app's OWN strings: `Digest:\s*\d`
  from `app/error.tsx`, the "Migrate demo database" link from the preview arm,
  `nextjs-portal` for the dev overlay. 16 of 16 clean once it was asking the
  right question.

- **AND THE SIGNED-IN WALL IS NOT THE LIMIT IT LOOKS LIKE: A CLIENT COMPONENT
  FROM BEHIND SIGN-IN CAN BE CLICKED IN A REAL BROWSER WITH NO CLERK, NO
  SERVER AND NO SOCKETS.** 2026-10-04, the sequel to the entry above and worth
  more than it, because the entry above ends at "the signed-in routes need CI or
  a laptop" and that is only true of ROUTES.

  The thing being verified is usually a `"use client"` component. It does not
  need Next, a database or a session — it needs React, its own imports, and the
  app's real CSS. So: bundle it, alias the two or three server-side imports to
  stubs, compile the REAL Tailwind from `apps/web/tailwind.config.ts` and
  `app/globals.css`, write an HTML file whose `<body>` carries the root layout's
  own classes, and open it over **`file://`**. No loopback, so none of the
  proxy-bypass misery in the entries above applies at all.

      esbuild entry.tsx --bundle --format=iife          # IIFE, so file:// needs no CORS
        # alias: next/navigation -> stub, @/lib/actions -> stub
        # a @/ onResolve plugin for the rest; nodePaths at the pnpm store
        # (the store, because apps/web/node_modules is EMPTY here — xlsx 403)
      tailwindcss -c <config compiled to .cjs> -i app/globals.css -o app.css
      chromium /opt/pw-browsers/chromium-1194/chrome-linux/chrome --no-sandbox

  **It found a real defect on its first run, and the defect was invisible to
  every other instrument in this repo.** `SubListingImport`'s row checkbox
  carried `className="mt-0.5"` and nothing else, so it rendered at the browser
  default **13×13** at both 1280 and 375 — the primary selection control on the
  screen. Eight other components in `components/` size theirs `h-4 w-4` or
  `h-5 w-5`. No unit test could see it: the screen suite runs in happy-dom,
  which does no layout and returns zeros from `getBoundingClientRect`, which is
  the same sentence as the "Cancel inherits the delete pixel" entry and the
  1.35-point line height on five phone screens.

  **THREE CONTROLS, AND NONE OF THEM IS OPTIONAL** — each answers a way the
  whole run could be about nothing:

  | control | the vacuous run it rules out |
  | --- | --- |
  | `getComputedStyle(body).backgroundColor === "rgb(15, 15, 15)"` | the CSS never loaded, so every layout number is from an unstyled page |
  | a `__reactFiber$` key across many elements, not one | it never hydrated, and React was never exercised |
  | **zero rows asserted BEFORE any text is typed** | a row already on the page would pass every count that follows |

  The third is the #61 watcher lesson as a positive requirement rather than a
  warning, and it is the one that would have been left out.

  **The harness lied first, again, and the control caught it, again.** The
  action stub returned `{ ok: true, data: … }`; the real type is
  `ActionResultWith<T> = { ok: true; value: T } | …` (`lib/actions/shared.ts`),
  so the component threw `Cannot destructure property 'leadsCreated' of
  'result.value'`. That read exactly like a product defect for a minute. Fixing
  the STUB resolved that one check and changed nothing else — 44 checks, 42
  passing, the two reds both the real checkbox — which is what makes the
  attribution evidence rather than a story. **A failing control is an
  instruction to fix the harness, not a result to read**, for the fourth time
  in this file.

  **AND THE CENSUS THAT WAS GOING TO GUARD IT WAS WRONG IN THE REPO'S FAVOURITE
  WAY.** A regex census over JSX reported **16** unsized checkboxes; the
  TypeScript AST reported **11**, from the same 26 `<input type="checkbox">`
  nodes. The five false positives included `SubListingImport.tsx` itself, after
  it was fixed. The cause is one character: `onChange={(event) => …}` contains a
  `>`, so `<input\b[^>]*?type="checkbox"[^>]*?>` ends at the ARROW and never
  reaches `className`. That is "a guard that parses by regex is one line break
  from seeing nothing" with the line break replaced by a fat arrow — and it
  fails in the direction that invents work rather than hiding it, which is the
  only reason it was caught. **Parse JSX with the AST. There is no regex that
  does this.**

  The 11 are PRE-EXISTING and span both lanes, so no census ships here: a guard
  needing an 11-entry exemption list documents a problem instead of preventing
  one. Filed as an issue instead, per the working agreement's rule 3.

  **What is deliberately NOT committed, and the better version of it.**
  `esbuild` is not a declared dependency of `apps/web` — it resolved out of the
  pnpm store — and a dependency cannot be added in this container, because
  `pnpm install` dies on the `xlsx` tarball 403. So this recipe lives here
  rather than in `e2e/`, where it would be an instrument nobody can install.
  The durable version needs no bundler at all and is Diego's call because it
  adds a route: mount the component at a **dev-only public route** outside
  `(app)`, and the existing `e2e-public` job — real Chromium, already in CI, no
  credentials — clicks it on every PR. That is the same trick the outlined-
  boundary investigation above used to measure the shell without signing in.

- **A MUTATION THAT SURVIVES IS NOT A WEAK GUARD — IT IS A CASE THAT PROVES
  NOTHING, AND THE CAUSE IS ALWAYS THAT SOMETHING ELSE WAS DOING THE WORK.**
  2026-10-04, on the subcontractor-listing parser. Five separate times in one
  session, several of them surviving twice before the right case was found.
  Written down because the reflex on a surviving mutation is to go and
  strengthen the CODE, and every single time the code was fine and the TEST was
  about nothing.

  | the condition under test | why the first case proved nothing |
  | --- | --- |
  | the licence digit width (6-10, not any 4+ run) | the furniture lines score one signal either way, so the width never decided anything |
  | a licence column excluded from the scope slot | a BARE `1065432` is excluded anyway by the slot's own `[A-Za-z]{4}` test |
  | the same, second attempt | `License No. 884201` is excluded by its `^(?:lic\|license\|dir\|reg)\b` prefix test |
  | a registration read only from its own column | a registration already alone in its column cannot tell an anchored pattern from an unanchored one |
  | the two wrap conditions (row-shape, fewer-columns) | the fixture rows were excluded by the OTHER two conditions, so dropping either changed nothing |
  | a bare city as data evidence | "Acme Builders" is rescued by `builders` being an entity marker, and anything naming drywall by a separate trade test |

  The case that finally distinguished each one was narrower and odder than the
  obvious one, and in every instance it took three tries: `CSLB 884201` (four
  letters, not in that prefix list, and exactly how a California form writes
  it); a registration buried in "Registration 1000012345 verified 2026-03-04";
  a COMPLETE row whose scope is printed lower case AND which is narrower than
  the row above; "Vang Carpentry | Union City | Scope of work: trim", which
  needs all four of no entity suffix, no trade word, a labelled scope cell and
  a city with no state code.

  **So the question to ask of a surviving mutation is not "is my guard too
  weak" but "what else in this function already handles the input I chose".**
  Answer that and the distinguishing case writes itself. The reflex of
  strengthening the code instead would, in two of the six rows above, have
  removed a working capability — see the entry below on the percentage refusal
  that nearly shipped.

  And the companion, which cost nothing and caught the worst of them: **read
  the TOTAL before the colour on every mutation run.** One run in this session
  reported `122 passed` where the baseline was 286, because a mutation left a
  dangling reference and three files failed to LOAD. Vitest called it green.
  That is the "68 passed" scar from the `InvoiceCounter` work arriving again as
  a 164-test drop, and the only reason it was not read as a pass is that the
  total is read first.

- **A REFUSAL CAN BE THE MORE DESTRUCTIVE OPTION, AND IT WILL FEEL LIKE THE
  CAUTIOUS ONE.** Same session. A review found that any lone percentage on a
  listing row became "listed at N% of the bid" — including `110%` and `999%`,
  and worse, the plausible ones: a bond column prints **100%** and a retention
  column prints **5%**.

  The first fix refused every unlabelled percentage. Two existing tests failed
  it and they were right: a fixture exists precisely because a form may carry a
  percentage column INSTEAD of a dollar column, so refusing deletes that
  capability outright — on the strength of a guess about bond columns, to guard
  against another guess, in a file where every fixture is synthetic and nobody
  has read a real form.

  **The architecture already had the answer and the refusal talked over it.**
  Every signal this feature writes lands PROPOSED and a person confirms it. So
  the useful move is not to withhold the figure but to tell that person what
  else the column could be: the value is claimed AND carries a concern naming
  the alternatives. Only `> 100` is refused, because no confirmation by anybody
  makes "999% of the bid" true — there is nothing left for a reviewer to decide.

  The general form, and it applies well beyond this parser: before removing a
  capability to avoid being wrong, ask what the system does with an uncertain
  value ANYWAY. Where a human already gates it, "claim it and say what is
  doubtful" beats "refuse it", and the refusal is the option that looks
  responsible while quietly costing the most.

- **A HEADER OPTION IN expo-router CAN BE DISCARDED IN SILENCE, AND THREE
  FIXES SHIPPED GREEN BECAUSE OF IT.** 2026-09-28/29, on the phone. The
  fourth member of the family directly above, and the one that finally says
  what the other three were circling.

  A notification tap that launches the app from a killed state lands on a
  screen with nothing behind it — no back chevron, and outside `(tabs)` no
  tab bar either. `/alerts` and `/job/<id>` are the only two such
  destinations (`push-target.ts`). Three PRs gave them a way out and **not
  one of them rendered**:

  | | approach | result |
  | --- | --- | --- |
  | #548 | `<Stack.Screen options={{ headerLeft }} />` inside `/alerts` | nothing rendered |
  | #553 | the same, copied to `/job/<id>` | nothing rendered |
  | #554 | moved to the LAYOUT as an options FUNCTION | nothing rendered |
  | #555 | a `<WayHome />` view in the screen BODY | **works, confirmed on a phone** |

  **Why, read out of the installed expo-router 57.0.21 rather than guessed.**
  `Stack.Screen` is two components wearing one name. In a layout its props
  are read by the navigator — that is how `title` reaches these screens, and
  `title` was visibly rendering throughout. Inside a PAGE it delegates to
  `views/Screen.js`, which calls `navigation.setOptions` from a layout effect
  behind `const isFocused = navigation.isFocused()` — read at render and
  never subscribed — plus an `isPreloaded` check. A cold deep-link launch is
  exactly where those are unsettled. And a FUNCTION passed as layout
  `options` is spread with `{ ...props.options }` (`StackScreen.js:78`);
  a function has no enumerable own properties, so it becomes `{}`.
  `StackScreen.js` warns about the first in its own source and its docstring
  points at `Stack.Title`/`Stack.Header` for page-level header config —
  all three fixes did the thing the library documents against.

  **THE EXPENSIVE PART WAS NOT THE FRAMEWORK, IT WAS THAT NO CHECK HERE
  COULD SEE IT.** `push-destination-exit.test.ts` asserted the screens
  CONTAINED `canGoBack` and `HeaderHomeButton`. They did. It passed with its
  **size and scope assertions both holding**, on a broken app. Rewritten to
  assert the LAYOUT wired those options: it did, it passed again, nothing
  rendered again. So:

      A census can tell you the code is THERE.
      It can never tell you a framework HONOURS it.

  That is the fourth member of the set, and it is not a failure of rigour —
  it is the limit of the instrument. Beside "nothing is missing from a
  directory you do not walk" and "nothing is missing from a list nobody
  imports", put **"nothing is ever missing from a question nobody is
  asking."**

  **So the rule is about where a fix LIVES, not how hard it is asserted.**
  Anything that must be visible on a cold-start screen goes in the screen
  BODY, where React renders it like every other pixel: a navigator cannot
  drop it, it cannot depend on focus or preload timing, and a test can
  assert it. Prefer a fix that is checkable over one that is conventional —
  three plausible unverifiable fixes are worth less than one verifiable one.

  **The mutation that distinguishes them is `make it render nothing`.**
  Every test written for #548, #553 and #554 stayed green under it, because
  each was asserting that a screen RECORDED an option, in a mock, while the
  framework threw the real one away. Under #555 the same mutation reds the
  census and all three screen tests. If that mutation leaves a suite green,
  the suite is measuring a mock.

  One smaller thing fell out and is worth keeping: `HeaderHomeButton`
  coloured its label `brand` — #facc15 on a near-white rail — which
  `tailwind`-side and `theme.ts` both forbid in as many words ("As TEXT,
  `link` is the readable amber — never `brand`"). `theme-contrast.test.ts`
  never caught it and neither did anyone else, **because the button it sat
  on never appeared.** A defect inside dead code is invisible to every
  instrument, including the ones written for that exact defect.

- **ONE SETTING, FIVE PRs, AND FOUR OF THE FIVE DEFECTS WERE FOUND BY
  CLICKING.** 2026-10-13, the openings-deduction setting (#763 → #767). The
  fifth member of the family directly above, and the one that says what the
  other four were circling: the instruments in this repo are good at the
  questions they ask, and a person on the screen asks a different question
  entirely.

  Every defect below shipped with its own census or unit test, written for
  that exact feature, passing honestly. Not one of them was weak. Each was
  blind in a way that only a human looking at the screen could see:

  | # | the defect | the check that was green |
  | --- | --- | --- |
  | #764 | the setting could not be SAVED at all | a census said the question rendered; a unit test said it was not `required` |
  | #765 | two of four options did the IDENTICAL thing, labelled as differing | "gives every answer a distinct threshold, so none is a dead option" |
  | #766 | "only the big ones" secretly meant 32 and no shop could say 50 | every test about what 32 does, all correct |
  | #767 | the size field sat under the WRONG option | the name, parse, save, threshold and quantity, all asserted |

  **Each one has a transferable shape, and they are different shapes.**

  **PRESENT IS NOT USABLE (#764).** The three business-scope radios are
  `required`, so the BROWSER refused to submit the form until all three were
  answered — and an optional fourth question sharing their form could not be
  saved by any company that had skipped onboarding, which is every company
  that had not answered those three. A census reads SOURCE; `required` does
  its work in the browser. No assertion about the new field could have found
  it, because the field was perfect and a SIBLING killed the submit. The fix
  was structural — its own form, its own action, nothing else on either — and
  the replacement assertion is a property source can carry: no `required`
  input anywhere on that form.

  **A DISTINCTNESS CHECK OVER A STORED ENUM CANNOT SEE A UI OPTION THAT IS NOT
  IN IT (#765).** The test iterated the three enum values. The form offered
  FOUR, because "unanswered" needs a control of its own, and unanswered
  resolves to the same 32 sq ft as "only the big ones" — so two of the four
  did the same thing while the label promised they differed. The collision is
  NOT a bug and must not be "fixed": unanswered has to stay 32 or existing
  quantities move. It is pinned as an equality now, with the screen's honesty
  asserted beside it. Same sentence as the rest of the family, one step
  sideways: *nothing is ever missing from a list that does not contain it.*

  **NO TEST HERE CAN SEE LAYOUT, AND THIS IS THE SECOND ENTRY TO PAY FOR IT
  (#767).** The size field was rendered after the options loop, which put it
  under the LAST radio while the number it sets applies only to the middle
  one. Nothing was mis-wired — name, parse, save, threshold, quantity all
  correct and all asserted. The "Cancel inherits the delete pixel" entry
  already records that happy-dom does no layout and returns zeros from
  `getBoundingClientRect`; that entry is about geometry WITHIN a control
  cluster, and this one is about which sentence a control appears to belong
  to. The only instrument for either is an eye. What source CAN carry, and
  now does, is that the field renders INSIDE the loop, conditional on its own
  option's value.

  **AND A CENSUS OVER A FILE THAT DOCUMENTS ITS OWN HISTORY MUST READ CODE,
  NEVER TEXT.** Paid twice in one file, hours apart. `OpeningDeductionForm.tsx`
  explains the bugs it exists to fix, and those explanations quote the very
  strings the assertions forbid: first the word `required`, then the phrase
  "the same as" in the comment recording that the label no longer says it.
  Both times the census failed on prose describing why the code is correct —
  the mirror image of #185, where a comment quoting a census's own pattern
  disarmed it. `clerkMountGate.test.ts` strips comments for the same reason.
  **The better the comment, the more likely it contains the string you are
  forbidding.** The helper is at module scope in
  `openingDeduction.test.ts`; use it, and do not assert over raw text in a
  file written in this repo's house style.

  **What this does NOT mean.** It is not an argument for fewer tests: the
  censuses caught four separate defects in the same work that a person would
  not have — an invented colour token (`text-ink-on-brand`, which Tailwind
  emits nothing for, so the Save label would have been invisible on the
  yellow), a `type="number"` input that would have SILENTLY BLANKED a shop's
  threshold and billed them at 32 (measured in real Chromium: a value the
  browser dislikes submits an empty string), an action nobody had decided
  whether Ask may call, and a function asking for a wider type than it reads.
  Two of those four were money bugs. The rule is not "trust clicking over
  tests"; it is **ask what question each instrument is answering, and notice
  that a screen answers one no test in this repo asks.**

  So the practical form, for the next feature: after the suites are green,
  the click-list is not a formality. Write it to ask the questions the suites
  structurally cannot — can a person actually complete this, do two controls
  do the same thing, is each control beside the thing it affects — and put a
  PERSON on it, with a numbered expected result per step so a wrong result is
  unmistakable.

- **A FILE THE AGENT BROWSER CANNOT FETCH, AND THE SEED THAT MAKES IT NOT
  MATTER.** 2026-10-03, verifying #596's payroll export.

  Two dead ends, both found the expensive way, so nobody spends the evening
  again:

    - **`javascript_tool` refuses a fetch whose URL carries a QUERY STRING**
      — it comes back `[BLOCKED: Cookie/query string data]`. That kills the
      obvious trick of fetching a download URL from the page's own context to
      read its bytes without downloading anything, because every such route
      here is `?jobId=…&weekStart=…`. Rewriting the call to hide the URL does
      not help; the guard is on the data, not the spelling.
    - **`chrome://downloads` is unreachable** ("Can't interact with
      browser-internal URLs"), so the agent cannot even find out where a file
      landed. And `~/Downloads` is not necessarily where it went: this
      machine runs FOUR connected Chrome instances, and a download triggered
      in one of them is invisible from the others.

  So **a file download is a human step**: the person clicks, and then either
  pastes the contents or says where it saved. Write down what the file MUST
  contain BEFORE asking — predicting first is what stops a wrong figure being
  rationalised once it is on screen.

  **The real fix is upstream, and it is the part worth copying.** The reason
  a production download was needed at all is that `e2e/lib/seedDatabase.ts`
  created a company, a contact and a job and nothing else — no crew, no craft
  classifications, no time entries. So `payroll-export.spec.ts` could prove
  the route, the content type, the filename, the header order and the 403,
  and could not prove **one figure in the file**. That is not a weak spec; it
  is the boundary of what an empty database can be asked.

  The seed now carries a fixed week of hours — ONE employee in TWO
  classifications, which is the smallest shape that catches all three of the
  mistakes the export exists to prevent: an unknown wage written as `0`
  instead of blank, a `rateKnown` flag that does not follow it, and a per
  diem repeated onto a second row and therefore paid twice. **When a check
  needs real rows to say anything, grow the fixture rather than reaching for
  production.**

- **Takeoff geometry is computed by code in `apps/web/lib/takeoff/`, never by
  the LLM.** Every length, thickness, area and coordinate comes from the PDF's
  own vector geometry; the model is used for interpretation only — what kind of
  sheet this is, what a run IS, what a label means — and no model reply in this
  repo carries a coordinate, a length or an area. Two fixture sets grade it and
  they are not interchangeable: `reports/takeoff-bench` is the only one with
  wall-footage ground truth, and `lib/takeoff/fixtures` is twenty sheets drawn
  by a different generator, where **only what a drawing PRINTS may be ground
  truth**. See `apps/web/lib/takeoff/NOTES.md` for the latest numbers and the
  known limitations in the order they cost the most.
- `FEATURE-AUDIT.md`: the 26-category roadmap and source of truth for
  what's built. It has drifted more than once; don't let it.
- `CHANGELOG.md`: newest first; says why decisions were made and the
  specific check for each trap, not which functions moved. **Your PR does
  NOT edit it.** It adds one file to `changelog.d/`, named after its branch
  — see `changelog.d/README.md` — and `pnpm changelog:collect` folds the
  pending entries in later, in one commit that touches nothing else.

  Added 2026-09-09, and the reason is a scar rather than tidiness. Because
  this file is newest-first, every PR prepended to the SAME FIRST LINE, so
  every merge re-conflicted every other open PR. In one day that cost four
  resolutions of one conflict across three PRs — #213's alone was resolved
  three times as `main` moved under it.

  **The expensive part was never the conflict.** On the middle attempt the
  push landed and CI NEVER QUEUED, because a PR conflicting with its base
  queues nothing — so the branch sat with no check at all, and that absence
  was nearly read as "still running" rather than "never started". That is
  the `gh pr checks` scar above arriving from the other direction: the
  conflict does not merely delay a merge, it silently removes the evidence
  you would merge on. One file per PR makes the collision impossible rather
  than survivable.

  `changelog-entries.test.ts` fails the build on a malformed entry and on
  this convention disappearing from `CHANGELOG.md`'s own preamble — the
  second being the one that matters, since a convention nobody is told
  about is abandoned within a week. Both were mutation-tested.
- `ARCHITECTURE.md`: read before adding any model that smells like
  line-item data — `Job`/`JobLineItem` is deliberately one unified object.
- `WORK-SPLIT.md`: the lanes.
