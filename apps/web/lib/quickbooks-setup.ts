/**
 * Whether QuickBooks is set up on THIS install, and what the Connect
 * control on /settings should offer.
 *
 * Pure, so the four states are unit-tested without a page — same shape as
 * `lib/jobber/setup.ts`'s `jobberSetup`/`importCardState`, which this
 * mirrors on purpose rather than inventing a second one.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE INTEGRATIONS-PAGE FRAMEWORK.
 * QuickBooks predates `lib/integrations/registry.tsx` and isn't wired to
 * it — its card on /settings/integrations is `kind: "external"`, a plain
 * link to /settings, and the actual "Connect QuickBooks" control lives on
 * /settings itself (`app/(app)/settings/page.tsx`), reading its own
 * `QuickBooksConnection` table rather than the generic `IntegrationConnection`
 * one. That is a deliberate, documented split (see that page's own
 * comment) and not something this file changes. What it fixes is that the
 * Connect button there had NO gate at all: with `QUICKBOOKS_CLIENT_ID`,
 * `_CLIENT_SECRET` or `_REDIRECT_URI` missing, `readQuickBooksConfig()`
 * (packages/integrations/src/quickbooks.ts) throws, so pressing Connect on
 * an unconfigured install sent the browser to /api/quickbooks/start and
 * hit an unguarded throw — a dead button with extra steps, the exact
 * failure shape Jobber's own comment above `JOBBER_REQUIRED_ENV` was
 * written to prevent, just never applied here.
 *
 * ONLY THREE VARIABLES, NOT FOUR. Jobber, Procore, DocuSign and CompanyCam
 * all fold `INTEGRATION_TOKEN_KEY` into their required list because they
 * encrypt tokens through `lib/crypto.ts`'s envelope before storing them on
 * the shared `IntegrationConnection` table. QuickBooksConnection is its own
 * table with plain `accessToken`/`refreshToken` columns (see billing.prisma
 * — this is the open plaintext-token issue #353, unrelated to and not
 * fixed by this file) and never reads `INTEGRATION_TOKEN_KEY` at all, so
 * listing it here would report an install "not set up" for a key it does
 * not use.
 */

export const QUICKBOOKS_REQUIRED_ENV = [
  "QUICKBOOKS_CLIENT_ID",
  "QUICKBOOKS_CLIENT_SECRET",
  "QUICKBOOKS_REDIRECT_URI",
] as const;

type Env = Record<string, string | undefined>;

/**
 * Reports which required variables are missing, by NAME only. `env` is
 * whatever the caller passes (`process.env` in real use, a fixture in
 * tests) — this never reads or returns a variable's VALUE, only whether
 * each name is present and non-blank, so nothing this function returns can
 * leak a client secret into a log line, an error message or a rendered
 * page.
 */
export function quickBooksSetup(env: Env): { configured: boolean; missing: string[] } {
  const missing = QUICKBOOKS_REQUIRED_ENV.filter((name) => !env[name]?.trim());
  return { configured: missing.length === 0, missing };
}

export type QuickBooksConnectCardState =
  /** No keys on this install: says so, offers nothing to press. */
  | "not-set-up"
  | "connect"
  | "connected";

/**
 * `hasConnection` is whether this company already has a `QuickBooksConnection`
 * row — QuickBooks has no NEEDS_REAUTH/ERROR status column (unlike the
 * generic framework's `IntegrationConnection.status`), so there is no
 * `reconnect` state to add here: a stale connection still reads as
 * "connected" and the existing "Test connection" button is how that is
 * discovered, unchanged by this file.
 */
export function quickBooksConnectCardState(
  configured: boolean,
  hasConnection: boolean,
): QuickBooksConnectCardState {
  if (!configured) return "not-set-up";
  return hasConnection ? "connected" : "connect";
}
