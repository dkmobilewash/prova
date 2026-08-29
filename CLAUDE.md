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
  surgically: schema files, `middleware.ts`, `Sidebar.tsx`,
  `lib/actions/shared.ts`, the actions barrel.

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
  piped to `tee` printed ALL GREEN once), and `rm -f .git/index.lock`.
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

## Hard-won technical rules

- **Sequence numbers** (case, RFI, submittal, invoice numbers) come from
  a counter row that only increments, bumped inside the same transaction
  as the insert. Never `max(n)+1`, never `count()+1` — anything derived
  from surviving rows is reissued when a row is deleted. See
  `SafetyCaseCounter`, `RfiCounter`, `SubmittalCounter`.
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
- **There is ONE Neon database and it is production.** Previews share it.
  Until 2026-08-28 every deployment migrated it, so a migration went live
  ON PUSH (`add_submittals` reached production from an unmerged branch);
  #18 gated that to `VERCEL_ENV=production`, so migrations now land when
  the PR MERGES. Three things still follow. Additive migrations only
  unless you've pinged first — a drop is irreversible against real data.
  Never answer yes to `prisma migrate dev` offering to reset the
  database: that offer is about PRODUCTION. It appears when your branch
  is missing a migration the DB already has, which is what branching off
  `main` while another branch's migration is live does — base the branch
  on the branch that owns the migration instead. And a preview of a
  branch adding a model now runs against a database WITHOUT those tables,
  so those pages fail on the preview until it merges; set
  `ALLOW_PREVIEW_MIGRATIONS=true` on that one branch in Vercel to verify
  by clicking, and take it off after.
- **A successful write can show up as an empty list — cause NOT
  established.** Observed once: the action returned ok, the row was in
  the database, the page said "Nothing on order", and a manual reload
  showed it. The pool was throwing `Timed out fetching a new connection`
  at the time and that is what this entry originally blamed. That was
  wrong: there is an error boundary now, but there was none then, so a
  throwing query would have 500'd rather than rendered an empty list —
  and a ColorZilla extension was injecting a hydration mismatch into
  `<body>` in the same repro. Untested hypothesis: the router refresh
  never fired and the STALE pre-create render stayed on screen, which
  fits all three observations. Do not repeat the pool explanation as
  fact. What IS established is the risk it pointed at: a page that fails
  after a commit invites a second click, and no create action is
  idempotent. #19 disabled 57 create buttons while their form is in
  flight and added an error boundary that says not to resubmit before
  reloading.
- `FEATURE-AUDIT.md`: the 26-category roadmap and source of truth for
  what's built. It has drifted more than once; don't let it.
- `CHANGELOG.md`: newest first; says why decisions were made and the
  specific check for each trap, not which functions moved.
- `ARCHITECTURE.md`: read before adding any model that smells like
  line-item data — `Job`/`JobLineItem` is deliberately one unified object.
- `WORK-SPLIT.md`: the lanes.
