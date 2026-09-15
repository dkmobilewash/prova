# PR 2/3 — Offline-first field reports

## Goal

Make `/api/v1/field-reports` safe for a phone that can be offline: a retried
POST can't double-file, every write carries the device identity, and a stale
offline edit resolves by **last-write-wins** (client timestamp) instead of
silently clobbering or blocking the foreman.

## Scope

- **Field reports only** — the first sync entity. The pattern generalizes but
  nothing else adopts it in this PR.
- **Create + update.** Offline **delete is out of scope** (it needs tombstones /
  soft-delete; delete stays online-only via the web action).
- **Read sync is "pull the full list per job"** — no `since=` delta cursor yet
  (a job's reports are tiny).
- **The Expo client is out of scope** — this only makes the API safe to sync
  against; the phone's local queue is the following PR.

## Schema (additive migration, no backfill)

`DailyFieldReport` gains three nullable columns and one unique index:

- `clientId String?` — device UUID, generated once on install; null for web writes.
- `clientOperationId String?` — the create-intent idempotency key (UUID, reused
  on retry); null for web writes.
- `clientUpdatedAt DateTime?` — the human's edit time as stamped by the client,
  the LWW conflict clock; null for web writes.
- `@@unique([companyId, clientOperationId])` — idempotent lookup. Postgres
  treats NULLs as distinct, so unlimited web rows (NULL key) coexist.

Fully additive (3 `ADD COLUMN` nullable + 1 `CREATE UNIQUE INDEX`), placed in
`packages/db/prisma/schema/migrations/`.

## Core (`lib/field-reports-core.ts`)

- `createFieldReport` → now `ActionResultWith<FieldReportRow>`, gains optional
  `clientId` / `clientOperationId` / `clientUpdatedAt`:
  - if `clientOperationId` given, `findUnique` by `(companyId, clientOperationId)`
    first → return the existing row (idempotent replay).
  - on P2002, **read `error.meta.target`** to tell the two constraints apart:
    - `(companyId, clientOperationId)` → concurrent-replay race → re-read and
      return the existing row;
    - `(jobId, reportDate)` → the existing "already exists for that date" sentence.
  - return the created row so the client gets the server `id` back.
- new `updateFieldReport(company, reportId, input)` → `ActionResultWith<{ applied, report }>`:
  - ownership check (report's `companyId === company.id`).
  - **LWW**: if incoming `clientUpdatedAt` is set AND stored `clientUpdatedAt` is
    set AND incoming is older → return the current row with `applied: false`
    (drop the stale write, never block).
  - else apply the edit, set `clientId` / `clientUpdatedAt` when provided →
    `applied: true`.
  - web edits (null `clientUpdatedAt`) always apply — server `@updatedAt` stays
    authoritative for them, preserving today's web behavior.
- `FieldReportRow` adds `clientId: string | null`, `clientUpdatedAt: string | null`.
- `listFieldReportsForJob` returns the new fields.

Capability gating stays at the caller (route/action), not the core — matching
the existing `FIELD_ONLY` comment (web create/update are deliberately not
MANAGE_FIELD-gated; the mobile route is).

## Web action (`lib/actions/fieldReports.ts`)

- `createDailyFieldReport` — behavior unchanged; just ignores the new `value`.
- `updateDailyFieldReport` — route through the new `updateFieldReport` core so
  web and mobile share one update path (web passes no client fields → identical).

## API routes

- `POST /api/v1/field-reports` — accepts optional `clientId` / `clientOperationId`
  / `clientUpdatedAt`; returns **201 + row** on create, **200 + row** on
  idempotent replay.
- new `PATCH /api/v1/field-reports/[id]` — `requireApiContext` (401) +
  `can(MANAGE_FIELD)` (403); parse JSON (400); `updateFieldReport`; 200 with
  `{ applied, report }`. No `revalidatePath`.

## Tests (`field-reports-core.test.ts`, FakeDb style)

- idempotent create: same `clientOperationId` twice → one row, same id returned.
- concurrent-replay race: P2002 on the clientOperationId target → re-read returns existing.
- same date, different opId → still the exact "already exists" sentence.
- update LWW: older `clientUpdatedAt` dropped (`applied:false`, current row returned); newer applied.
- update with null `clientUpdatedAt` (web) always applies.
- update refuses a cross-company report id.

## Verification

typecheck / lint / test / build (demo env). The demo DB will be one migration
behind until this merges — `check-schema.mjs` warns and continues locally
(expected).

## Sequencing (important)

PR 2/3 edits `field-reports-core.ts` and the route **that PR 1 introduces**, so
it must branch off `main` **after PR 1 merges** — never off PR 1's branch. This
document is the design; implementation starts on a fresh branch once PR 1 lands.

## Process

- Schema migration → announce in `#prova-build` **before push** (repo rule 4).
- `changelog.d/<branch>.md` entry.
- Explicit-path commits only (no `git add -A`).
