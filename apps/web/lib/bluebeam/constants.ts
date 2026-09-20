/**
 * The cookie that carries Bluebeam's OAuth `state` between
 * /api/bluebeam/start and /api/bluebeam/callback.
 *
 * Same shape and the same lesson as the Jobber, QuickBooks, Procore and
 * CompanyCam cookies (#136 §2): the cookie is the browser's own, so
 * NOTHING in it decides whose account gets connected. The callback takes
 * the company and user from the signed-in session; `companyId`/`userId`
 * here are only a cross-check that whoever finishes the flow started it.
 */
export const BLUEBEAM_OAUTH_STATE_COOKIE = "bluebeam_oauth_state";

export const BLUEBEAM_OAUTH_STATE_MAX_AGE_SECONDS = 600;

export interface BluebeamOAuthCookiePayload {
  state: string;
  companyId: string;
  userId: string;
}

export function readBluebeamCookie(raw: string | undefined): BluebeamOAuthCookiePayload | null {
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
      return parsed as unknown as BluebeamOAuthCookiePayload;
    }
  } catch {
    // Malformed — treated as missing.
  }
  return null;
}
