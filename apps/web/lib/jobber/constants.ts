/**
 * The cookie that carries Jobber's OAuth `state` and PKCE verifier between
 * /api/jobber/start and /api/jobber/callback.
 *
 * Same shape and the same lesson as QuickBooksOAuthCookiePayload
 * (lib/quickbooks-constants.ts, #136 §2): the cookie is the browser's own,
 * so NOTHING in it decides whose account gets connected. The callback reads
 * the company and user from the signed-in session; `companyId`/`userId`
 * here are only a cross-check that whoever finishes the flow started it.
 *
 * The PKCE verifier lives here rather than server-side because the only
 * party it protects against is someone who intercepts the authorization
 * code on its way back — and they do not have this browser's httpOnly
 * cookie. Jobber supports S256 only.
 */
export const JOBBER_OAUTH_STATE_COOKIE = "jobber_oauth_state";

/** Ten minutes: Jobber's own authorization codes expire in ten. */
export const JOBBER_OAUTH_STATE_MAX_AGE_SECONDS = 600;

export interface JobberOAuthCookiePayload {
  state: string;
  codeVerifier: string;
  companyId: string;
  userId: string;
}

export function readJobberCookie(raw: string | undefined): JobberOAuthCookiePayload | null {
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
      return parsed as unknown as JobberOAuthCookiePayload;
    }
  } catch {
    // Malformed — treated as missing.
  }
  return null;
}
