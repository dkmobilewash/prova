/**
 * The cookie that carries ACC's OAuth `state` and PKCE verifier between
 * /api/acc/start and /api/acc/callback.
 *
 * Same shape and the same lesson as the Procore, Jobber and QuickBooks
 * cookies (#136 §2): the cookie is the browser's own, so NOTHING in it
 * decides whose account gets connected. The callback reads the company and
 * user from the signed-in session; `companyId`/`userId` here are only a
 * cross-check that whoever finishes the flow is who started it.
 */
export const ACC_OAUTH_STATE_COOKIE = "acc_oauth_state";

/** Ten minutes: long enough to sign in to Autodesk, short enough that a
 * stale cookie does not linger. Same value as Procore's. */
export const ACC_OAUTH_STATE_MAX_AGE_SECONDS = 600;

export interface AccOAuthCookiePayload {
  state: string;
  codeVerifier: string;
  companyId: string;
  userId: string;
}

export function readAccCookie(raw: string | undefined): AccOAuthCookiePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.state === "string" &&
      typeof parsed.codeVerifier === "string" &&
      typeof parsed.companyId === "string" &&
      typeof parsed.userId === "string"
    ) {
      return parsed as unknown as AccOAuthCookiePayload;
    }
  } catch {
    // Malformed — treated as missing.
  }
  return null;
}
