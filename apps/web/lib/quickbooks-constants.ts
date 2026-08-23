// Shared between the server action that starts the OAuth flow
// (initiateQuickBooksConnect) and the callback route that finishes it
// (app/api/quickbooks/callback), so they stay in sync on the cookie name
// and payload shape.
export const QUICKBOOKS_OAUTH_STATE_COOKIE = "qbo_oauth_state";

/**
 * The cookie carries the CSRF `state` value AND who initiated the
 * connection (companyId/userId) — not just the state. Intuit's redirect
 * back to our callback is a third-party-initiated navigation that can
 * outlast a short-lived Clerk session token (e.g. if the user spends a
 * minute on Intuit's consent/2FA screen); requiring a *live* Clerk session
 * in the callback route forces a re-login detour at exactly the wrong
 * moment and drops the in-flight OAuth exchange. Putting company/user
 * identity in this single-use, httpOnly, short-lived cookie instead means
 * the callback is self-contained: possession of the cookie (set only by
 * the OWNER-gated initiateQuickBooksConnect action) is itself sufficient
 * authorization, so the callback route needs no separate auth check.
 */
export interface QuickBooksOAuthCookiePayload {
  state: string;
  companyId: string;
  userId: string;
}
