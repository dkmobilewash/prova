### C Stream Bid gets its own front door: bid.cstream.ai, its own landing page and signed-in shell, and no way through to the CRM (Cyrus)
`feat/bid-foundation`

**Why.** A 30-year sub told us the full app "does everything", so nobody can
say what it is for. The founder's call (2026-10-25): sell one connected chain
for one trade first — bid log → plan takeoff + wall types → estimate + bid
recap → proposal — as **C Stream Bid**, at `bid.cstream.ai`. Same codebase,
same Clerk instance, same database, same account (a Bid company that upgrades
keeps every job). The two products are not reachable from each other.

**What this foundation does.**

- **Routing, decided in one pure function.** `lib/bid/surface.ts`
  `decideSurface(host, path)`: on a host whose first label is `bid` (or one
  named in `BID_HOSTS`), `/<path>` is rewritten to `/bid/<path>` and anything
  that is not a Bid route or a shared path REDIRECTS to the Bid home — a CRM
  URL never renders there. On the production app host `/bid/*` is a 404. On
  previews and localhost nothing changes and `/bid/*` is reachable directly.
  Shared everywhere: `/sign-in`, `/sign-up`, `/api`, `/_next`, `/__clerk`,
  `/privacy`, `/terms`, static files. Bid is an ALLOWLIST of its own segments,
  pinned to the directories under `app/bid` by a test, because a hand-copied
  CRM denylist drifts in the dangerous direction. `surface.test.ts` drives it
  with `bid.cstream.ai`, `app.cstream.ai`, a vercel.app preview and
  `localhost:3000` against every path class.
- **Auth lands back in Bid.** The shared sign-in/sign-up pages ask
  `bidAuthDestination` (host, or a `redirect_url` into `/bid`) and FORCE the
  redirect into Bid rather than `/dashboard` → `/welcome`. The destination is
  always a path the function built, never the raw `redirect_url`. Company
  creation is the unchanged `requireCompanyContext`. Bid's signed-in pages are
  protected by middleware on the path that RENDERS, since the CRM's protected
  list has never heard of `/estimates`.
- **Its own shell** — `app/bid/(signed-in)/layout.tsx`, `components/bid/` —
  wordmark, Bids · Estimates · Wall types · Price book · Settings, sign-out.
  The last two are traced from what the chain reads (price book: wall lines
  are cost-only without it; settings: recap rates, waste, opening deduction,
  clause library, crafts, GCs).
- **A landing page** (`/bid`) that says the one sentence, the four steps and
  "the AI reads, it never does the maths", with sign-up and the free
  drawing-set read. In the public e2e table.
- **Screens.** Wall types is REAL (one loader, `lib/wall-types-view.ts`, now
  used by both products). Bids shows the real Due soon list (one query,
  `lib/bids-due-soon-query.ts`). Estimates, Price book, Settings are honest
  "coming in this build" stubs; each page file's header is the exact porting
  brief for the next wave — every CRM href in that screen's import closure.

**The two censuses, both mutation-tested.** `bidLinkCensus.test.ts`: no
navigation target in anything Bid's routes IMPORT (followed through `app/` and
`components/`, read by the TypeScript AST) points outside Bid — the CRM route
set derived from `app/(app)` and checked against `git ls-files`. Importing
`PageHeader` into a Bid page turns it red on `Home → /dashboard`, which is
the point: the leak is never in the file you are looking at. Its sight ends
at `lib/` (a server action's `redirect()` is not seen — `createJob` is the
known one) and it says so. `bidNavCensus.test.ts`: the CRM nav carries no
`/bid` entry, at runtime and in source.

**Not done here:** pretty URLs inside Bid (links are `/bid/…`, which the Bid
host serves as-is), the domain itself (DNS + Vercel + the Clerk production
instance's allowed origins for `bid.cstream.ai`), and every screen marked as
a stub.
