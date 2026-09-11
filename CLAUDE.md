# CLAUDE.md — how agents work on Prova

Prova is an operating system for specialty-trade construction
subcontractors (framing/drywall, plaster, EIFS, ceilings, fireproofing)
working under GCs. Every design decision is made for the sub, not the GC.
Two people build it: Cyrus (cyrusobiz-coder — not an engineer; he runs
and clicks everything) and Diego (dkmobilewash — engineer, owns the
Vercel deployment and repo settings). Each drives their own agent.

## The prime directive: verify by result, never by claim

- Merged = `git log main..origin/<branch>` prints nothing. A PR exists =
  its ref is in `git ls-remote origin 'refs/pull/*/head'`. Migrations
  exist = `prisma migrate status` NAMES them (it has printed "No
  migration found" and "up to date" in the same run).
- `typecheck`, `lint`, and a full `build` passing is necessary and
  nowhere near sufficient. Real bugs here have only ever been found by
  loading the page and doing the thing. After building anything, give
  Cyrus a numbered click-list with the exact expected result, phrased so
  a wrong result is unmistakable.
- Say plainly when something is your fault, what broke, and what changes.

## Coordination

- Slack `#prova-build` (C0BSUM5G4T0) is the shared channel between the
  two agents. Before writing code: `git fetch && git log --oneline -20
  origin/main` AND read the last ~20 channel messages. After anything
  lands on main: post one line. Before touching a file in the other
  lane: post and wait. NEVER post connection strings, keys, or tokens
  anywhere — Signal or a call only.
- Lanes are in WORK-SPLIT.md. Diego: estimating, job costing,
  billing/AIA, retainage, WIP, AI, and `apps/web/app/(app)/jobs/[id]/page.tsx`
  (fixed section slots: Retainage → Field Reports → Pay Apps — insert at
  your slot, never at the end). Cyrus: self-contained verticals (safety,
  vendors, equipment, punch lists, RFIs, submittals). Shared, edit
  surgically: schema files, `middleware.ts`, `navItems.tsx`,
  `lib/actions/shared.ts`, the actions barrel.

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
  and after ANY merge run `git log origin/main..<branch>` — empty output
  is the only proof it landed. "The PR says Merged" is not.
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

- **Sequence numbers** come from a counter row that only increments,
  bumped inside the same transaction as the insert. Never `max(n)+1`,
  never `count()+1` — anything derived from surviving rows is reissued
  when a row is deleted. `SafetyCaseCounter`, `RfiCounter`,
  `SubmittalCounter` and `MaterialOrderCounter` (`operations.prisma`),
  `ChangeOrderCounter` (`jobs.prisma`), `BackchargeCounter`
  (`backcharges.prisma`), `CloseoutSubmissionCounter` (`closeout.prisma`),
  `InvoiceCounter` and `ContractDocumentVersionCounter`
  (`billing.prisma`).

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
  real empty states with a way out; owner-only destructive actions via
  `assertOwner(context, "specific message")`.

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

  Two things no agent in this repo can do, so do not spend the afternoon
  looking: **the Vercel MCP has no environment-variable tool** — projects,
  deployments, build and runtime logs, deployment protection, domains and
  analytics, and nothing that reads or writes an env var (checked three
  times now, most recently 2026-09-09) — and a read-write blob token is a
  credential, so it never travels through an agent channel regardless.
  Connecting the store to an environment in the dashboard mints the
  variable itself, which is better than pasting one: nothing is copied, so
  nothing can be pasted into the wrong project.
- **A successful write can show up as an empty list — cause NOT
  established, and now with TWO dead explanations instead of one.**
  Observed: the action returned ok, the row was in the database, the page
  said "Nothing on order", and a manual reload showed it. Issue #61.

  **Dead explanation 1 — the connection pool.** The pool was throwing
  `Timed out fetching a new connection` at the time and this entry
  originally blamed it. Wrong: there is an error boundary now, but there
  was none then, so a throwing query would have 500'd rather than
  rendered an empty list. A ColorZilla extension was also injecting a
  hydration mismatch into `<body>` in the same repro, so that run had two
  confounds in it.

  **Dead explanation 2 — "the router refresh never fired".** This entry
  carried that as the leading untested hypothesis, on the grounds that it
  fits all three observations. It does fit, and it is still WRONG. Read
  out of the INSTALLED Next source on 2026-09-03 (`next 15.5.23` — note
  `package.json` says `^15.1.3`, which is not what is on disk):

    - `server/web/spec-extension/revalidate.js:156` sets
      `pathWasRevalidated = true` UNCONDITIONALLY, with a
      `// TODO: only revalidate if the path matches` still in the source.
      **The path argument you pass is irrelevant to this mechanism.**
    - so `skipFlight` is false at `server/app-render/action-handler.js:773`
      and flight data IS appended to the action's POST response;
    - and an action POST does not send the `RSC` header, so
      `flightRouterState` is undefined and the render walks from the root
      — **action flight is always a root render.**

  So a Server Action that calls `revalidatePath` and RETURNS a value
  re-renders the client with no `router.refresh()` at all. The call is
  redundant in the happy path. This app carries its own control proving
  it: `TakeoffForm` has no `router.refresh()`, its action revalidates at
  `lib/actions/jobs.ts:511`, and it demonstrably works.

  Every client-side branch that could silently leave a stale page was
  walked and each is unreachable for this app's action shape, including
  action forwarding — ruled out from `server-reference-manifest.json`,
  where all 26 action-carrying pages hold the full manifest, so
  `selectWorkerForForwarding` can never pick a different worker.

  **Two numbers this entry used to imply, both wrong.** The
  `router.refresh()` tally is 29 of 98 client components, not "18 of 60".
  And NO write action in this codebase is missing revalidation — all ten
  naive grep hits are false positives, `fieldReports.ts` routing through
  its own `revalidateBoth()` helper. "Somebody forgot to revalidate" is
  eliminated everywhere, so do not go looking for it.

  **Dead explanation 3 — and the differential that killed it. THE CAPTURE
  THIS ENTRY ASKED FOR HAS NOW BEEN RUN** (2026-09-05, production, signed
  in, both submits in one tab). `/settings` add-a-licence against
  `/jobs/[id]` add-a-takeoff-line, instrumented from the page rather than
  read off DevTools — a `fetch` wrapper for the `Next-Action` POST, a
  `console.error` wrapper, and Resource Timing for sizes.

  | | A: licence | B: takeoff |
  | --- | --- | --- |
  | `x-action-revalidated` | `[[],1,0]` | `[[],1,0]` |
  | decoded response | 34,342 B | 75,806 B |
  | action round-trip | 1,544 ms | 1,519 ms |
  | first byte -> stream end | 1,543 -> 3,749 ms | 1,516 -> 4,411 ms |
  | console | clean | clean |

  **There is no difference.** Both surviving possibilities die on this:
  the flight half was NOT dropped (34 KB of page payload arrived on the
  suspect), and revalidation WAS signalled (byte-identical header). A
  fourth hypothesis raised for that run — that `<form action={fn}>`
  behaves differently from `<form onSubmit>`, which is the one structural
  difference between these two components — is not supported either.

  What the numbers do show is the response STARTING at ~1.5s and finishing
  streaming at 3.7-4.4s, scaling with payload. That is the server
  re-rendering the whole page after the action, and the DOM cannot update
  before it lands. A human tester independently measured 5-7s on unrelated
  routes the day before. **So the shape is post-action server render cost,
  not a lost update** — which makes it #118's territory (Neon compute wake,
  `connection_limit=5`) rather than this issue's.

  Do NOT re-run the capture. It has been run and it answered. What remains
  genuinely unexplained is only the ORIGINAL observation — a committed row,
  an empty list, a reload that fixes it — IF it was seen well after the
  render had finished. Nobody recorded how long they waited, which is why
  a report of this shape now needs a timestamp before it counts as
  evidence.

  What IS established, and was from the start: a page that fails after a
  commit invites a second click, and no create action is idempotent. #19
  disabled 57 create buttons while their form is in flight and added an
  error boundary that says not to resubmit before reloading.

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
  NOT ANNOUNCING IT.** Three sightings on `ep-little-sea` in two days,
  4-5 Sep 2026, all on the operator company's own rows:

    - a `SalesActivity` reading "ZZ-TEST Phase C verification call —
      logged by Claude on 2026-09-04 to verify SalesActivity persistence",
      which appeared on a lead BETWEEN a tester's page load and their
      delete attempt — so the delete guard refused a lead they had just
      seen as empty. The guard was right; the data moved underneath them;
    - a `SalesLead` named "CLAUDE-VERIFY Phase C (delete me)" with a
      $1,200/mo opportunity, which sat in the `/sales` pipeline band
      inflating the live figures;
    - a `CompanyLicense` named "ZZTEST Nevada — ZZ-TEST 61A" on
      `/settings`, which is what made the #61 watcher above false-positive.

  **That third one is the cost worth naming: a stray test row did not just
  clutter a page, it corrupted an experiment and nearly produced a wrong
  answer to a question two sessions had already burned days on.** A
  measurement taken on this account is not taken on a quiet one.

  So: **before timing or counting anything on production, screenshot or
  record the starting state of the rows you are about to measure**, and
  say in the report that you did. And if you are the session writing:
  demo-project or scratch database, never `ep-little-sea`; if a production
  write is genuinely unavoidable, post it in Slack BEFORE the write, not
  after, and delete it in the same sitting. The demo project exists
  precisely so this does not have to happen — see the three-Neon-projects
  table above.

  **Cleared 2026-09-07: the CLAUDE-VERIFY lead is gone** — its opportunity
  and activity deleted first, then the lead, by hand through the app. The
  pipeline band reads true again. `deleteSalesLead` refuses while any child
  row exists and names only the non-zero kinds, so a lead like this cannot
  be removed in one click; children first. `ZZ-TEST Pipeline` was reported
  separately and is NOT known to be cleared.

  **THE CAUSE IS STILL UNIDENTIFIED, and here is what has been ruled out so
  nobody spends the afternoon again.** All four checked rather than assumed:

    - **Previews are not it.** They resolve `ep-patient-lake`; only
      production resolves `ep-little-sea`. Confirmed from build logs on two
      unrelated branches plus a production control — see the preview
      paragraph above for the method, which needs no dashboard access.
      This was the best hypothesis, and its stated reason was ALSO wrong:
      it said a preview URL, being a different host from `app.cstream.ai`,
      "would pass the egress proxies that 403 both agents' containers".
      Measured 2026-09-09 from an agent container, twice: the preview host
      is denied exactly like production — `curl` fails at CONNECT and the
      proxy's own status endpoint names it, `connect_rejected`, "gateway
      answered 403 to CONNECT (policy denial)". So an agent container
      cannot reach a preview either, and the hypothesis was dead on a
      second ground nobody had checked. The conclusion is unchanged and
      still rests on the build logs above;
    - **Scheduled Routines are not it.** One exists on Diego's account, the
      hourly status desk. Disabled, and its prompt is STATUS ONLY — no
      code, no pushes, and no path to the app;
    - **The shared cloud environment does not carry credentials.** Every
      session on it shares one `environment_id`, and one of them has no
      `DATABASE_URL` and no `.env` at all, so the environment injects
      nothing;
    - **The Vercel MCP cannot leak the string.** It has no env-var tool;
      checked twice rather than asserted from a partial search.

  What survives is a CHECKOUT holding the connection string. Two sessions
  were live on this repo at the time on Diego's account — "CRM Buildout"
  and "Prova contractor operating system", the Phase C sales lane, which
  matches the symptom since the rows were leads and opportunities.

  **A cloud session cannot be questioned from another container.**
  `ListAgents` sees only this machine, and `SendMessage` to either title
  returns `No agent named '…' is reachable` — tried, not assumed. There is
  no `list_events` tool here either, so their transcripts are unreadable
  from a peer. The check has to be run INSIDE each session, by whoever has
  it open: `grep -rl "ep-little-sea" . --exclude-dir=node_modules
  --exclude-dir=.git`, reporting the HOST only and never the string.
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
