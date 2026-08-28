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
- Scripts start with `set -e` AND `set -o pipefail` (a failed build
  piped to `tee` printed ALL GREEN once), and `rm -f .git/index.lock`.
- Cyrus's PAT lacks the `workflow` scope: pushes touching
  `.github/workflows/` are rejected — that file changes via GitHub's web
  editor only.
- `.git/info/exclude` patterns must be anchored with `/` (an unanchored
  `punch-lists*` matched a source directory).
- CI (`ci.yml`) runs lint + typecheck but NOT `pnpm build` — and only
  `build` catches some real breakage (see traps). Run a full build
  locally before pushing.

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

## Docs — update in the same PR as the work

- `FEATURE-AUDIT.md`: the 26-category roadmap and source of truth for
  what's built. It has drifted more than once; don't let it.
- `CHANGELOG.md`: newest first; says why decisions were made and the
  specific check for each trap, not which functions moved.
- `ARCHITECTURE.md`: read before adding any model that smells like
  line-item data — `Job`/`JobLineItem` is deliberately one unified object.
- `WORK-SPLIT.md`: the lanes.
