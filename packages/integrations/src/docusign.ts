// DocuSign — OAuth 2.0 (Confidential Authorization Code Grant, per account)
// and the four eSignature REST v2.1 calls this app makes: create an envelope,
// read one, download its documents, void it.
//
// VERIFIED on 2026-09-18 against developers.docusign.com (read in a browser;
// the site is client-rendered and answers a plain fetch with an empty shell)
// and against DocuSign's own Node SDK source (docusign/docusign-esign-node-
// client, src/ApiClient.js, src/oauth/*.js, src/api/EnvelopesApi.js):
//
//   /platform/auth/confidential-authcode-get-token/
//       authorize at https://{account-d|account}.docusign.com/oauth/auth,
//       token at .../oauth/token, userinfo at .../oauth/userinfo; the code
//       lives TWO MINUTES; PKCE optional, S256 only; refresh with
//       grant_type=refresh_token and a NEW refresh token comes back.
//   /platform/auth/reference/obtain-access-token/
//       client credentials go in `Authorization: Basic base64(key:secret)`;
//       the response carries access_token, token_type, refresh_token,
//       expires_in (seconds), scope.
//   /platform/auth/reference/scopes/   `signature` (eSignature REST) and
//       `extended` (each refresh returns a refresh token with a FULL ~30-day
//       life; without it the refresh token dies 30 days after first login).
//   SDK oauth/Account.js   userinfo accounts[]: account_id, is_default,
//       account_name, base_uri. API calls go to {base_uri}/restapi/v2.1/
//       accounts/{account_id}/...
//   /docs/esign-rest-api/reference/envelopes/envelopedocuments/get/
//       documentId `combined` (+ certificate=false) = the signed documents
//       as one PDF; `certificate` = the certificate of completion alone.
//   SDK EnvelopesApi.update   void = PUT the envelope with
//       {"status":"voided","voidedReason":"..."}.
//   SDK model EventNotification / ConnectEventData   the envelope-level
//       Connect fields used below, incl. includeHMAC and integratorManaged.
//
// NOT VERIFIED, said here so nobody mistakes it for fact:
//   - the access token's lifetime. The docs say only "expires_in"; this code
//     uses whatever number comes back and refreshes 30 minutes early, which
//     is DocuSign's own recommendation.
//   - whether the OLD refresh token dies the moment a new one is issued. The
//     docs say a new one is issued, not what happens to the old. The caller
//     stores the pair with a compare-and-swap as if it rotates (Jobber's
//     rule), which is correct either way.
//   - whether an ENVELOPE-level eventNotification sent with a customer's own
//     token honours `integratorManaged` (sign with OUR account's HMAC keys).
//     The "Managing HMAC for multiple accounts" page says envelope-level
//     configs can be integrator-managed "using the API", and that the token
//     used "will identify the main account" — a customer's token identifies
//     THEIR account. If it signs with their keys instead, our verification
//     fails closed (the webhook is refused) and status still arrives through
//     the Refresh button, which reads the same envelope with the same token.
//     This has to be settled against a real demo account.

export const DOCUSIGN_ENV = {
  clientId: "DOCUSIGN_CLIENT_ID",
  clientSecret: "DOCUSIGN_CLIENT_SECRET",
  redirectUri: "DOCUSIGN_REDIRECT_URI",
  environment: "DOCUSIGN_ENV",
  connectHmacKey: "DOCUSIGN_CONNECT_HMAC_KEY",
} as const;

export type DocuSignEnvironment = "demo" | "production";

/** The OAuth host per environment — SDK oauth/BasePath.js. */
export const DOCUSIGN_OAUTH_HOSTS: Record<DocuSignEnvironment, string> = {
  demo: "account-d.docusign.com",
  production: "account.docusign.com",
};

/** `signature` to send and read envelopes; `extended` so the refresh token
 * keeps a full life on every refresh rather than dying 30 days after the
 * owner first connected. */
export const DOCUSIGN_SCOPES = ["signature", "extended"] as const;

export interface DocuSignConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: DocuSignEnvironment;
  oauthHost: string;
}

type Env = Record<string, string | undefined>;

/** Null when anything is missing, or DOCUSIGN_ENV is not exactly `demo` or
 * `production` — never a throw, and never a guess at which environment a
 * typo meant. */
export function readDocuSignConfig(env: Env = process.env): DocuSignConfig | null {
  const clientId = env[DOCUSIGN_ENV.clientId]?.trim();
  const clientSecret = env[DOCUSIGN_ENV.clientSecret]?.trim();
  const redirectUri = env[DOCUSIGN_ENV.redirectUri]?.trim();
  const environment = env[DOCUSIGN_ENV.environment]?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  if (environment !== "demo" && environment !== "production") return null;
  return { clientId, clientSecret, redirectUri, environment, oauthHost: DOCUSIGN_OAUTH_HOSTS[environment] };
}

/** The consent-screen URL, with PKCE (S256, the only method DocuSign takes). */
export function docuSignAuthorizeUrl(config: DocuSignConfig, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    scope: DOCUSIGN_SCOPES.join(" "),
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://${config.oauthHost}/oauth/auth?${params.toString()}`;
}

export interface DocuSignTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds, from the response's own `expires_in`. */
  expiresIn: number;
}

/** Thrown by the token endpoint. `invalidGrant` means the refresh token is
 * dead and only a person reconnecting fixes it. The message never holds a
 * token. */
export class DocuSignAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly invalidGrant: boolean,
  ) {
    super(message);
    this.name = "DocuSignAuthError";
  }
}

/** DocuSign answered 401 to an API call: refresh and try once more. */
export class DocuSignUnauthorizedError extends Error {
  constructor() {
    super("DocuSign refused the access token (401)");
    this.name = "DocuSignUnauthorizedError";
  }
}

/** Any other failure, with a message safe to log and to show: DocuSign's own
 * errorCode and message (which name the problem — "INVALID_EMAIL_ADDRESS_FOR_
 * RECIPIENT"), never a token or a document. */
export class DocuSignApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode: string | null = null,
  ) {
    super(message);
    this.name = "DocuSignApiError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function basicAuth(config: DocuSignConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64")}`;
}

async function tokenRequest(config: DocuSignConfig, fetchImpl: FetchLike, body: URLSearchParams): Promise<DocuSignTokens> {
  const response = await fetchImpl(`https://${config.oauthHost}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(config),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "Cache-Control": "no-store",
    },
    body: body.toString(),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Not JSON — reported below as missing fields.
  }
  if (!response.ok) {
    // The error CODE only: a token response body can hold a token, and this
    // message ends up in logs.
    const code = typeof parsed.error === "string" ? parsed.error : "unknown_error";
    throw new DocuSignAuthError(`DocuSign token endpoint returned ${response.status} (${code})`, response.status, code === "invalid_grant");
  }
  const accessToken = parsed.access_token;
  const refreshToken = parsed.refresh_token;
  const expiresIn = Number(parsed.expires_in);
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    throw new DocuSignAuthError("DocuSign token endpoint answered without an access and refresh token", response.status, false);
  }
  // A missing or silly lifetime is treated as one hour, which only means the
  // caller refreshes sooner than it had to.
  return { accessToken, refreshToken, expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600 };
}

export function exchangeDocuSignCode(
  config: DocuSignConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike = fetch,
): Promise<DocuSignTokens> {
  return tokenRequest(
    config,
    fetchImpl,
    new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: codeVerifier }),
  );
}

export function refreshDocuSignTokens(
  config: DocuSignConfig,
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<DocuSignTokens> {
  return tokenRequest(config, fetchImpl, new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
}

export interface DocuSignAccount {
  accountId: string;
  accountName: string;
  /** e.g. https://demo.docusign.net — WITHOUT /restapi. */
  baseUri: string;
}

/**
 * Which DocuSign account the token acts for: the user's DEFAULT account
 * (`is_default`), or the only one. A user in several accounts sends from
 * whichever DocuSign marks default — the card names it, so an owner can see
 * which one they connected.
 */
export async function fetchDocuSignAccount(
  config: DocuSignConfig,
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<DocuSignAccount> {
  const response = await fetchImpl(`https://${config.oauthHost}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Cache-Control": "no-store" },
  });
  if (response.status === 401) throw new DocuSignUnauthorizedError();
  if (!response.ok) throw new DocuSignApiError(`DocuSign userinfo answered ${response.status}.`, response.status);
  const body = (await response.json()) as {
    accounts?: { account_id?: string; is_default?: boolean | string; account_name?: string; base_uri?: string }[];
  };
  const accounts = (body.accounts ?? []).filter((a) => a.account_id && a.base_uri);
  const chosen = accounts.find((a) => a.is_default === true || a.is_default === "true") ?? (accounts.length === 1 ? accounts[0] : undefined);
  if (!chosen?.account_id || !chosen.base_uri) {
    throw new DocuSignApiError("DocuSign did not say which account to send from.", response.status);
  }
  const baseUri = chosen.base_uri.replace(/\/+$/, "");
  // A base_uri that is not https on a docusign host would send documents
  // and tokens somewhere else. It comes from DocuSign, but it is stored and
  // reused, so it is checked once here.
  if (!/^https:\/\/[a-z0-9.-]+\.docusign\.(net|com)$/i.test(baseUri)) {
    throw new DocuSignApiError("DocuSign returned an account address this app does not recognise.", response.status);
  }
  return { accountId: chosen.account_id, accountName: chosen.account_name?.trim() || "DocuSign account", baseUri };
}

/* ------------------------------------------------------------------ */
/* Envelopes                                                           */
/* ------------------------------------------------------------------ */

export interface DocuSignApiTarget {
  accessToken: string;
  baseUri: string;
  accountId: string;
}

function accountUrl(target: DocuSignApiTarget, path: string): string {
  return `${target.baseUri}/restapi/v2.1/accounts/${encodeURIComponent(target.accountId)}${path}`;
}

async function apiError(response: Response): Promise<DocuSignApiError> {
  let errorCode: string | null = null;
  let message = "";
  try {
    const body = (await response.json()) as { errorCode?: string; message?: string };
    errorCode = typeof body.errorCode === "string" ? body.errorCode : null;
    message = typeof body.message === "string" ? body.message : "";
  } catch {
    // Not JSON.
  }
  return new DocuSignApiError(
    `DocuSign answered ${response.status}${errorCode ? ` (${errorCode})` : ""}${message ? `: ${message}` : "."}`,
    response.status,
    errorCode,
  );
}

async function call(target: DocuSignApiTarget, path: string, init: RequestInit, fetchImpl: FetchLike): Promise<Response> {
  const response = await fetchImpl(accountUrl(target, path), {
    ...init,
    headers: { Authorization: `Bearer ${target.accessToken}`, Accept: "application/json", ...(init.headers ?? {}) },
  });
  if (response.status === 401) throw new DocuSignUnauthorizedError();
  if (!response.ok) throw await apiError(response);
  return response;
}

/** The envelope-definition body. Built by lib/docusign/envelope-request.ts. */
export type DocuSignEnvelopeDefinition = Record<string, unknown>;

export async function createDocuSignEnvelope(
  target: DocuSignApiTarget,
  definition: DocuSignEnvelopeDefinition,
  fetchImpl: FetchLike = fetch,
): Promise<{ envelopeId: string; status: string; statusDateTime: string | null }> {
  const response = await call(
    target,
    "/envelopes",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(definition) },
    fetchImpl,
  );
  const body = (await response.json()) as { envelopeId?: string; status?: string; statusDateTime?: string };
  if (!body.envelopeId) throw new DocuSignApiError("DocuSign accepted the envelope but returned no envelope id.", response.status);
  return { envelopeId: body.envelopeId, status: body.status ?? "", statusDateTime: body.statusDateTime ?? null };
}

/** The fields of an envelope this app reads — names from the SDK's
 * model/Envelope.js. */
export interface DocuSignEnvelopeState {
  envelopeId: string;
  status: string;
  sentDateTime: string | null;
  deliveredDateTime: string | null;
  completedDateTime: string | null;
  declinedDateTime: string | null;
  voidedDateTime: string | null;
  voidedReason: string | null;
}

export async function getDocuSignEnvelope(
  target: DocuSignApiTarget,
  envelopeId: string,
  fetchImpl: FetchLike = fetch,
): Promise<DocuSignEnvelopeState> {
  const response = await call(target, `/envelopes/${encodeURIComponent(envelopeId)}`, { method: "GET" }, fetchImpl);
  const body = (await response.json()) as Record<string, unknown>;
  const text = (key: string) => (typeof body[key] === "string" && body[key] ? (body[key] as string) : null);
  return {
    envelopeId: text("envelopeId") ?? envelopeId,
    status: text("status") ?? "",
    sentDateTime: text("sentDateTime"),
    deliveredDateTime: text("deliveredDateTime"),
    completedDateTime: text("completedDateTime"),
    declinedDateTime: text("declinedDateTime"),
    voidedDateTime: text("voidedDateTime"),
    voidedReason: text("voidedReason"),
  };
}

/** `combined` (certificate excluded) or `certificate`, as PDF bytes. */
export async function downloadDocuSignDocument(
  target: DocuSignApiTarget,
  envelopeId: string,
  which: "combined" | "certificate",
  fetchImpl: FetchLike = fetch,
): Promise<Uint8Array> {
  const query = which === "combined" ? "?certificate=false" : "";
  const response = await call(
    target,
    `/envelopes/${encodeURIComponent(envelopeId)}/documents/${which}${query}`,
    { method: "GET", headers: { Accept: "application/pdf" } },
    fetchImpl,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A PDF starts with %PDF. Anything else stored as "the signed contract"
  // would be an error page wearing the name of evidence.
  if (bytes.length < 5 || Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") {
    throw new DocuSignApiError(`DocuSign's ${which} download was not a PDF.`, response.status);
  }
  return bytes;
}

export async function voidDocuSignEnvelope(
  target: DocuSignApiTarget,
  envelopeId: string,
  voidedReason: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await call(
    target,
    `/envelopes/${encodeURIComponent(envelopeId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "voided", voidedReason }),
    },
    fetchImpl,
  );
}
