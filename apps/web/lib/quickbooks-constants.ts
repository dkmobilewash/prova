// Shared between the server action that starts the OAuth flow
// (initiateQuickBooksConnect) and the callback route that finishes it
// (app/api/quickbooks/callback), so they stay in sync on the cookie name.
export const QUICKBOOKS_OAUTH_STATE_COOKIE = "qbo_oauth_state";
