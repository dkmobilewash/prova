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

## The working agreement (agreed in Slack 2026-08-29)

Written down here because an agreement that lives only in a Slack
scrollback gets broken by whoever didn't scroll far enough.

1. **No PR smaller than a finished, clicked-through capability.** Several
   capabilities in one PR is fine and usually better. No docs-only PRs —
   documentation rides along with the work it describes.
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
- **Do not promote a preview to production.** Merge to `main` instead, so
  the build actually runs. Previews are public (no deployment protection),
  carry the branch's latest commit at a stable alias, and are what browser
  testing should point at.
- Previews share PRODUCTION's database — they run on Vercel's env vars,
  so a preview reads and writes `ep-little-sea`, the real data. Browser
  testing against a preview creates real rows; use an obvious prefix and
  delete them afterwards.
  Until 2026-08-28 every deployment migrated it, so a migration went live
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
  the old escape hatch and no longer exists; it left with the build's
  migrate step.)
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
