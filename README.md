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
| `DATABASE_URL` | both `.env` files | Postgres connection string (a Neon pooled connection string works) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `apps/web/.env` | From your Clerk app's API Keys page |
| `CLERK_SECRET_KEY` | `apps/web/.env` | From your Clerk app's API Keys page |

The remaining `NEXT_PUBLIC_CLERK_*_URL` vars in `apps/web/.env.example`
are already set to sensible defaults (`/sign-in`, `/sign-up`,
`/dashboard`) — only change them if you rename those routes.

`packages/db/.env` and `apps/web/.env` can point at the same
`DATABASE_URL`; they're separate files because Prisma CLI commands run
from `packages/db` and Next.js reads its own `.env` from `apps/web`.

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

- **apps/web** → Vercel. Set the same env vars from `apps/web/.env.example`
  as Vercel project environment variables (with real values), and set
  `DATABASE_URL` to your Neon connection string.
- **Database** → run `pnpm db:migrate` (or `prisma migrate deploy` in a
  release step) against production `DATABASE_URL` before/during deploy.
