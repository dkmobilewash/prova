# Prova

A contractor operating system. The estimate, the contract, the budget, and
change orders are the same underlying data — see [ARCHITECTURE.md](./ARCHITECTURE.md)
for why that's the whole point of this codebase.

This is Phase 00 (Foundation): a Turborepo monorepo with a Prisma schema,
Clerk auth, and a minimal CRUD flow proving the data model end to end.
See ARCHITECTURE.md for what's deliberately not built yet.

## Stack

- **Turborepo** monorepo, TypeScript throughout, **pnpm** workspaces
- `apps/web` — Next.js (App Router), Tailwind CSS, deployed on Vercel
- `packages/db` — Prisma schema + migrations, Postgres (Neon in production)
- `packages/ui` — shared components
- `packages/integrations` — empty placeholder, no integrations built yet
- **Clerk** for auth (email/password + Google)

## Prerequisites

- Node.js 20+
- pnpm 10+ (`corepack enable` will pick up the version pinned in `package.json`)
- A Postgres database (local, or a [Neon](https://neon.tech) project)
- A [Clerk](https://clerk.com) application (free tier is fine)

## Local setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Environment variables

Copy the example env files:

```bash
cp packages/db/.env.example packages/db/.env
cp apps/web/.env.example apps/web/.env
```

Fill in:

| Variable | Where | Description |
| --- | --- | --- |
| `DATABASE_URL` | both `.env` files | Postgres connection string — the Neon *pooled* one (host ends `-pooler`) |
| `DIRECT_URL` | `packages/db/.env` | The Neon *direct* (unpooled) connection string. Only `prisma migrate` uses it; a connection pooler can't hold the session-level advisory locks migrations take |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `apps/web/.env` | From your Clerk app's API Keys page |
| `CLERK_SECRET_KEY` | `apps/web/.env` | From your Clerk app's API Keys page |
| `QUICKBOOKS_CLIENT_ID` | `apps/web/.env` | From your Intuit Developer app's Keys page — only needed to use the `/settings` QuickBooks connection |
| `QUICKBOOKS_CLIENT_SECRET` | `apps/web/.env` | From your Intuit Developer app's Keys page — never commit this |
| `QUICKBOOKS_REDIRECT_URI` | `apps/web/.env` | `<your origin>/api/quickbooks/callback`, must exactly match a redirect URI registered on that Intuit app |
| `ANTHROPIC_API_KEY` | `apps/web/.env` | From your Anthropic Console — required for all three AI features (compliance document extraction, draft-estimate-from-text, WIP summaries). Without it, those features fail at request time rather than at startup. |
| `BLOB_READ_WRITE_TOKEN` | `apps/web/.env` | From your Vercel project's Blob store (Storage tab → create a store with "Add a read-write token" checked). Required for any file upload — compliance documents and subcontract agreement PDFs. Without it, uploads fail. |
| `CRON_SECRET` | `apps/web/.env` + Vercel | Any long random string. Vercel sends it as `Authorization: Bearer …` on the nightly alert-digest cron; the route rejects every request without it, including when the variable is unset. Nothing unattended sends until this exists. |
| `NOTIFY_BASE_URL` | `apps/web/.env` + Vercel | The origin links in a scheduled email point at — `https://app.cstream.ai` in production. Deliberately configuration rather than a request header: the cron mails other people, so the host cannot come from whoever triggered it. No default; unset means the run refuses to send. |

The remaining `NEXT_PUBLIC_CLERK_*_URL` vars in `apps/web/.env.example`
are already set to sensible defaults (`/sign-in`, `/sign-up`,
`/dashboard`) — only change them if you rename those routes.
`QUICKBOOKS_ENVIRONMENT` defaults to `sandbox` in `.env.example`; set it
to `production` only once you're using a production Intuit app.

`packages/db/.env` and `apps/web/.env` can point at the same
`DATABASE_URL`; they're separate files because Prisma CLI commands run
from `packages/db` and Next.js reads its own `.env` from `apps/web`.
`DIRECT_URL` is only read by the Prisma CLI, so it belongs in
`packages/db/.env` alone.

### 3. Run migrations

```bash
pnpm db:migrate
```

This runs `prisma migrate dev` against `DATABASE_URL`, creating the
`Company`, `User`, `Contact`, `Job`, `JobLineItem`, `ChangeOrder`, and
`ChangeOrderLineItemEdit` tables.

To inspect the database visually:

```bash
pnpm db:studio
```

### 4. Run the dev server

```bash
pnpm dev
```

Visit `http://localhost:3000`. Sign up (Clerk) — a `Company` is created
automatically on first sign-in. From `/dashboard`, create a job, add line
items, and open `/jobs/[id]` to see them rendered as a contract summary
and to add a change order.

## Other commands

```bash
pnpm lint        # lint all packages
pnpm typecheck   # typecheck all packages
pnpm build       # build all packages (what CI runs)
pnpm db:generate # regenerate the Prisma client after a schema change
```

## CI

`.github/workflows/ci.yml` runs lint, typecheck, and build on every PR
and on pushes to `main`. It uses placeholder `DATABASE_URL` and Clerk
keys — none of those steps connect to a real database or Clerk instance,
so no secrets are required in the repo for CI to pass.

## Deploying

- **apps/web** → Vercel, with the project's Root Directory set to
  `apps/web`. Set the same env vars from `apps/web/.env.example` as Vercel
  project environment variables (with real values), plus `DATABASE_URL` and
  `DIRECT_URL` from Neon.
- **Tick every environment for `DATABASE_URL` and `DIRECT_URL`, not just
  Production.** Prisma resolves `directUrl = env("DIRECT_URL")` while loading
  the schema, so a Preview build that can't see it fails with a P1012 schema
  validation error before it connects to anything — and any branch that isn't
  the project's Production Branch builds as a Preview.
- **Database** → migrations do **not** run during the deploy. They are applied
  by CI when a PR merges to main (`.github/workflows/migrate.yml`). Merging is
  the decision to change production; a build is not — and a build-time migrate
  is invisible to a PROMOTION, which reuses the preview's already-built output
  and so never re-runs the build command at all.
  `apps/web/vercel.json` sets the build command to `pnpm --filter @prova/db run
  check:schema && pnpm turbo run build --filter=@prova/web` — it CHECKS the
  schema and applies nothing. Keep it in the file rather than in the Vercel
  dashboard, so a change to it is visible in code review.
  (This entry read `migrate:deploy` here for a long time after the build
  stopped migrating, which is the promotion scar re-asserted as fact in the
  README — the exact way it came to be believed the first time.)
