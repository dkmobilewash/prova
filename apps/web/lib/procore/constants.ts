/**
 * The cookie that carries Procore's OAuth `state` and PKCE verifier between
 * /api/procore/start and /api/procore/callback.
 *
 * Same shape and the same lesson as the Jobber and QuickBooks cookies
 * (#136 §2): the cookie is the browser's own, so NOTHING in it decides whose
 * account gets connected. The callback reads the company and user from the
 * signed-in session; `companyId`/`userId` here are only a cross-check that
 * whoever finishes the flow is who started it.
 */
export const PROCORE_OAUTH_STATE_COOKIE = "procore_oauth_state";

/** Ten minutes: long enough to sign in to Procore, short enough that a
 * stale cookie does not linger. */
export const PROCORE_OAUTH_STATE_MAX_AGE_SECONDS = 600;

export interface ProcoreOAuthCookiePayload {
  state: string;
  codeVerifier: string;
  companyId: string;
  userId: string;
}

export function readProcoreCookie(raw: string | undefined): ProcoreOAuthCookiePayload | null {
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
      return parsed as unknown as ProcoreOAuthCookiePayload;
    }
  } catch {
    // Malformed — treated as missing.
  }
  return null;
}
