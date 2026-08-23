// QuickBooks Online OAuth 2.0 client — authorization_code flow only.
//
// Scope decision (see ARCHITECTURE.md "QuickBooks / accounting sync"): this
// connects accounting data only. QuickBooks Payments is intentionally not
// requested — this app has its own manual Payment records (see Invoice /
// Payment models) and isn't wired to charge cards through Intuit.
//
// All endpoints below are Intuit's documented OAuth 2.0 / Accounting API /
// OpenID Connect endpoints — nothing here is invented.
// https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0

export const QUICKBOOKS_SCOPES = "com.intuit.quickbooks.accounting openid profile email phone address";

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

export type QuickBooksEnvironment = "sandbox" | "production";

export interface QuickBooksConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QuickBooksEnvironment;
}

/// Reads connection config from environment variables. Called at the start
/// of every function below rather than once at module load, so a missing
/// env var fails the specific request that needed it instead of crashing
/// module import for unrelated code.
export function readQuickBooksConfig(): QuickBooksConfig {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
  const environment = process.env.QUICKBOOKS_ENVIRONMENT === "production" ? "production" : "sandbox";

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing QuickBooks config: QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, and QUICKBOOKS_REDIRECT_URI must all be set.",
    );
  }

  return { clientId, clientSecret, redirectUri, environment };
}

function accountingApiBase(environment: QuickBooksEnvironment): string {
  return environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

function userInfoUrl(environment: QuickBooksEnvironment): string {
  return environment === "production"
    ? "https://accounts.platform.intuit.com/v1/openid_connect/userinfo"
    : "https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo";
}

export interface QuickBooksTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

interface TokenEndpointResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds, access token
  x_refresh_token_expires_in: number; // seconds, refresh token
  token_type: string;
}

function toQuickBooksTokens(body: TokenEndpointResponse): QuickBooksTokens {
  const now = Date.now();
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    accessTokenExpiresAt: new Date(now + body.expires_in * 1000),
    refreshTokenExpiresAt: new Date(now + body.x_refresh_token_expires_in * 1000),
  };
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

async function parseTokenErrorBody(response: Response): Promise<string> {
  const text = await response.text();
  return `QuickBooks token endpoint returned ${response.status}: ${text}`;
}

/// Builds the URL to redirect the user to for the Intuit consent screen.
/// `state` should be a random, unguessable value the caller has bound to
/// this request (e.g. a short-lived signed cookie) and re-verified when the
/// callback comes back, as CSRF protection.
export function getAuthorizeUrl(state: string): string {
  const config = readQuickBooksConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: QUICKBOOKS_SCOPES,
    redirect_uri: config.redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/// Exchanges the authorization code from the callback for an access +
/// refresh token pair.
export async function exchangeCodeForTokens(code: string): Promise<QuickBooksTokens> {
  const config = readQuickBooksConfig();

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config.clientId, config.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseTokenErrorBody(response));
  }

  const body = (await response.json()) as TokenEndpointResponse;
  return toQuickBooksTokens(body);
}

/// Exchanges a still-valid refresh token for a new access + refresh token
/// pair. QuickBooks rotates the refresh token on every use — the caller
/// must persist the new one, not just the new access token.
export async function refreshTokens(refreshToken: string): Promise<QuickBooksTokens> {
  const config = readQuickBooksConfig();

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config.clientId, config.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseTokenErrorBody(response));
  }

  const body = (await response.json()) as TokenEndpointResponse;
  return toQuickBooksTokens(body);
}

/// Revokes an access or refresh token, ending the connection on Intuit's
/// side. Call with the refresh token to invalidate the whole connection.
export async function revokeToken(token: string): Promise<void> {
  const config = readQuickBooksConfig();

  const response = await fetch(REVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config.clientId, config.clientSecret),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    throw new Error(await parseTokenErrorBody(response));
  }
}

export interface QuickBooksCompanyInfo {
  companyName: string;
  legalName?: string;
  country?: string;
}

/// Fetches basic company info — used as the "test connectivity" call, since
/// it's read-only, cheap, and confirms both the access token and realmId
/// are valid together.
export async function getCompanyInfo(
  realmId: string,
  accessToken: string,
): Promise<QuickBooksCompanyInfo> {
  const config = readQuickBooksConfig();
  const url = `${accountingApiBase(config.environment)}/v3/company/${realmId}/companyinfo/${realmId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`QuickBooks companyinfo request returned ${response.status}: ${text}`);
  }

  const body = (await response.json()) as {
    CompanyInfo: { CompanyName: string; LegalName?: string; Country?: string };
  };

  return {
    companyName: body.CompanyInfo.CompanyName,
    legalName: body.CompanyInfo.LegalName,
    country: body.CompanyInfo.Country,
  };
}

export interface QuickBooksUserInfo {
  sub: string;
  email?: string;
  givenName?: string;
  familyName?: string;
}

/// Fetches the OpenID Connect userinfo for the person who authorized the
/// connection — not currently persisted, but useful for a one-time "you
/// connected as X" confirmation.
export async function getUserInfo(accessToken: string): Promise<QuickBooksUserInfo> {
  const config = readQuickBooksConfig();

  const response = await fetch(userInfoUrl(config.environment), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`QuickBooks userinfo request returned ${response.status}: ${text}`);
  }

  const body = (await response.json()) as {
    sub: string;
    email?: string;
    givenName?: string;
    familyName?: string;
  };

  return {
    sub: body.sub,
    email: body.email,
    givenName: body.givenName,
    familyName: body.familyName,
  };
}
