/**
 * The cookie that carries DocuSign's OAuth `state` and PKCE verifier between
 * /api/docusign/start and /api/docusign/callback.
 *
 * Same shape and the same lesson as the Jobber and QuickBooks cookies
 * (#136 §2): the cookie is the browser's own, so NOTHING in it decides whose
 * account gets connected. The callback takes the company and user from the
 * signed-in session; `companyId`/`userId` here are only a cross-check that
 * whoever finishes the flow started it.
 */
export const DOCUSIGN_OAUTH_STATE_COOKIE = "docusign_oauth_state";

/** Ten minutes to get through DocuSign's sign-in. (The code DocuSign hands
 * back lives only two minutes, but that clock starts after sign-in.) */
export const DOCUSIGN_OAUTH_STATE_MAX_AGE_SECONDS = 600;

export interface DocuSignOAuthCookiePayload {
  state: string;
  codeVerifier: string;
  companyId: string;
  userId: string;
}

export function readDocuSignCookie(raw: string | undefined): DocuSignOAuthCookiePayload | null {
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
      return parsed as unknown as DocuSignOAuthCookiePayload;
    }
  } catch {
    // Malformed — treated as missing.
  }
  return null;
}

/** Where DocuSign Connect delivers envelope events. On the same origin as
 * the redirect URI, which is the one address this install is configured
 * with — never read from a request's Host header, which the caller chooses. */
export const DOCUSIGN_CONNECT_PATH = "/api/docusign/connect";

export function docuSignConnectUrl(redirectUri: string): string | null {
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== "https:") return null;
    return `${url.origin}${DOCUSIGN_CONNECT_PATH}`;
  } catch {
    return null;
  }
}
