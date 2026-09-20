### Real browser tests, for the ten screens a pilot tester touches (Cyrus)
`cyrus/e2e`

The suite was ~5,000 unit tests in happy-dom, which does no layout —
`getBoundingClientRect` returns zeros there, which is exactly why every
phone-width bug this repo has fixed (the armed-delete overlap, the tour's
own #324 positioning bug) was found by a human clicking, not by a test.
A same-day audit had to find phone bugs by grepping Tailwind classes for
`sm:` because nothing could look at a rendered page. That gap is now
covered by nineteen Playwright specs across sixteen files, real Chromium,
chromium-only plus one narrow (375px) viewport project — not WebKit/iOS
emulation, a plain narrow Chromium viewport, since the brief was
chromium-only.

**Auth, the part worth being explicit about:** every signed-in spec goes
through Clerk's own official testing package (`@clerk/testing/playwright`
— `clerkSetup()` in Playwright's `globalSetup`, `clerk.signIn({ page,
emailAddress })` per spec) against real Clerk test users on the
DEVELOPMENT instance, created via the Backend API with the `+clerk_test`
suffix that suppresses email delivery. **No application code changed to
support this** — `middleware.ts` and `lib/auth.ts` are untouched, there is
no `TEST_MODE` flag and no env-gated bypass anywhere. A test-only hole in
production auth would have been worse than shipping no E2E suite at all.

Four seeded personas (`apps/web/e2e/lib/personas.ts`), not one shared
account, because "each spec independent, no ordering dependencies" is not
achievable against a single company — a spec asserting "zero jobs" and a
spec creating one would race. EMPTY (read-only, every empty-state spec),
MAIN (pre-seeded with one job directly through Prisma, never through the
UI, so job-detail/schedule/ask/tour/settings-import don't depend on
another spec's write), JOB_CREATE (its own company, the one spec allowed
to create a job through the UI), and FIELD (a second User inside MAIN's
company, role MEMBER / jobFunction FIELD, for the money-rail invariant).

**Database safety**: `apps/web/e2e/lib/assertScratchDatabase.ts` reuses
`scratchProblem()` from `packages/db/scripts/connection-target.mjs`
verbatim — the same guard `vitest.db.setup.mts` uses — and refuses to run
against anything but a local scratch Postgres before a single Clerk user
is minted or a single row written. No env-var escape hatch, matching that
file's own reasoning.

**What's covered, briefly** — `/pilot` signed out (headline, sign-up link,
no horizontal scroll at 375px); a brand-new company's dashboard (Getting
started card, every step link resolves); the Ask panel opened from the
topbar (network stubbed, no real model spend, asserts the thinking state
and — at 375px — that the panel is fully on screen, the exact bug class
the audit found by inspection); `/jobs/new` end to end; a job detail page
(sections render, the Retainage → Daily field reports → Pay applications
fixed-slot order); `/contacts` empty state and its form; `/schedule` rows
including at 375px; `/punch-lists` and `/field-reports` empty states;
`/settings/import`'s boxes and its exact refusal sentence for an old
`.xls` file; the Help "walk me through this page" tour (on-screen
containment, Next, Esc) — the CLAUDE.md-documented case a DOM-only test
structurally cannot check. Plus two invariants: a failed contact save
(forced with a real server-side refusal — `paymentTermsDays` set to
non-numeric text — not a client-side HTML5 block, since the form's
`reset()` only runs on success) keeps what was typed, and a FIELD-function
member sees no dollar figure on the money rail (#350), checked against an
OWNER positive control on the same company so the negative isn't vacuous.

No spec uses `waitForTimeout`; every assertion is web-first
(`expect(locator)...`, which retries) or a real bounding-box/scroll-width
read. None proved flaky in the writing of this suite — none were dropped.

**CI**: a new `e2e` job in `.github/workflows/ci.yml`, modeled on
`dbtest`'s Postgres service, that installs Playwright's chromium browser,
builds, and runs the suite against `next start`. It needs two NEW
repository secrets, `E2E_CLERK_PUBLISHABLE_KEY` / `E2E_CLERK_SECRET_KEY`
(the DEVELOPMENT Clerk instance's own keys) — named `E2E_` rather than
after anything existing so they can never be confused with a production
key, the same discipline this repo already uses for
`DEMO_DATABASE_URL`/`DEMO_DIRECT_URL`. The job fails loudly with a named
error if they are missing rather than silently skipping. Adding them is a
repo-settings action this PR does not take by itself.
