/**
 * The cookie that carries CompanyCam's OAuth `state` between
 * /api/companycam/start and /api/companycam/callback.
 *
 * Same shape and the same lesson as the Jobber, QuickBooks and Procore
 * cookies (#136 §2): the cookie is the browser's own, so NOTHING in it
 * decides whose account gets connected. The callback reads the company and
 * user from the signed-in session; `companyId`/`userId` here are only a
 * cross-check that whoever finishes the flow is who started it. No PKCE
 * verifier, because none is sent — see companyCamAuthorizeUrl.
 */
export const COMPANYCAM_OAUTH_STATE_COOKIE = "companycam_oauth_state";

/** Ten minutes: long enough to sign in to CompanyCam, short enough that a
 * stale cookie does not linger. */
export const COMPANYCAM_OAUTH_STATE_MAX_AGE_SECONDS = 600;

export interface CompanyCamOAuthCookiePayload {
  state: string;
  companyId: string;
  userId: string;
}

export function readCompanyCamCookie(raw: string | undefined): CompanyCamOAuthCookiePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.state === "string" &&
      typeof parsed.companyId === "string" &&
      typeof parsed.userId === "string"
    ) {
      return parsed as unknown as CompanyCamOAuthCookiePayload;
    }
  } catch {
    // Malformed — treated as missing.
  }
  return null;
}
