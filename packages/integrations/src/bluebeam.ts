// Bluebeam — OAuth 2.0 and a Studio API client for pushing a PDF into a
// Studio Session, listing what is in it, and reading markup STATUS back.
//
// READ THIS BEFORE TRUSTING ANY REQUEST/RESPONSE SHAPE BELOW. Bluebeam's
// own developer portal (developers.bluebeam.com) is a client-rendered
// Salesforce Experience Cloud site: every automated fetch of it — by this
// session's tools — returned an empty "Developer Portal" shell with no
// body content, the same failure mode DocuSign's docs briefly had before
// being read in a browser. Unlike DocuSign (whose client below was
// checked against the published Node SDK's actual source), there is no
// SDK to read Bluebeam's exact JSON field names from. So this file is
// split, deliberately, into two trust levels:
//
//   VERIFIED — cross-checked from TWO independent fetches of Bluebeam's
//   own support/help content (support.bluebeam.com, which is NOT the
//   client-rendered portal and returns real text) that agreed with each
//   other:
//     - OAuth 2.0, Authorization Code grant. Authorize:
//       `{host}/oauth2/authorize?response_type=code&client_id=...
//       &redirect_uri=...&scope=...&state=...`. Token: POST
//       `{host}/oauth2/token` with form fields grant_type, code (or
//       refresh_token), redirect_uri, client_id, client_secret, scope.
//       Quoted example from support.bluebeam.com/developer/
//       authentication-guide.html: "curl https://api.bluebeam.com/oauth2/
//       token -d grant_type=authorization_code -d code={...} -d
//       redirect_uri={...} -d client_id={...} -d client_secret={...} -d
//       scope= offline_access {your requested scopes} -X POST".
//     - Access tokens live 60 minutes; authorization codes live 5 minutes;
//       a refresh token stays valid indefinitely as long as it is used at
//       least once every 7 days, and dies after 7 days of inactivity.
//     - Region base hosts: US `api.bluebeam.com`, DE
//       `api.bluebeamstudio.de`, AU `api.bluebeamstudio.com.au`, UK
//       `api.bluebeamstudio.co.uk`, SE `api.bluebeamstudio.se`. Access is
//       restricted to those five regions — nothing else is reachable.
//     - Scopes: the quoted authorize example above requests
//       "full_prime offline_access jobs"; a separate summary of the same
//       guide additionally names `read_prime` (read-only) and `full_user`.
//       The two do not fully agree on naming (`full_prime` vs `full_user`)
//       — this client uses `full_prime offline_access`, the literal quoted
//       example minus the Automated-Jobs scope this app does not use,
//       because a quoted string is stronger evidence than a paraphrase.
//     - The Studio API has three object groups — Sessions, Projects, Jobs
//       — plus Session Files, Session Markups, Session Users and related
//       endpoints, under a `/publicapi/v1/` base path (seen literally in
//       a Bluebeam-hosted Postman collection reference as
//       "https://api.bluebeam.com/publicapi/v1/sessions/").
//
//   NOT INDEPENDENTLY VERIFIED — inferred from PROSE descriptions of the
//   guide's content (Bluebeam's own words, paraphrased by the fetch that
//   read them, not a schema this code has seen), never invented from
//   nothing:
//     - The exact JSON field names in a session-create request/response,
//       a file-upload request/response, and a markup object. The guide
//       says session creation takes "session name, notification
//       preferences, access restrictions, optional expiration date,
//       permission sets" and is a POST to the Sessions endpoint; it says
//       file upload is three steps — "creating metadata, uploading to
//       AWS, and confirming the upload" — and that Studio does not accept
//       PDF/A. It does NOT say what the JSON keys are called.
//     - Every function below that touches Sessions/Files/Markups reads
//       its response PERMISSIVELY (several plausible key names tried,
//       nothing required beyond an id) so a wrong guess about a field
//       name fails soft — a sync log entry that says less than it could,
//       never a thrown exception that corrupts a connection's state.
//
// BEFORE THIS SHIPS TO A REAL CUSTOMER: whoever obtains Bluebeam Developer
// Portal sandbox access (see apps/web/lib/bluebeam/setup.ts) should run
// one real session-create and one real file-upload against it and correct
// any field name here that the sandbox proves wrong. That is one function
// each, not a redesign — see the comments on `createBluebeamSession` and
// `uploadFileToBluebeamSession` for exactly which lines to check first.

export const BLUEBEAM_REGIONS = ["US", "DE", "AU", "UK", "SE"] as const;
export type BluebeamRegion = (typeof BLUEBEAM_REGIONS)[number];

/** Verified region hosts — see the header comment. */
export const BLUEBEAM_REGION_HOSTS: Record<BluebeamRegion, string> = {
  US: "https://api.bluebeam.com",
  DE: "https://api.bluebeamstudio.de",
  AU: "https://api.bluebeamstudio.com.au",
  UK: "https://api.bluebeamstudio.co.uk",
  SE: "https://api.bluebeamstudio.se",
};

export function isBluebeamRegion(value: string): value is BluebeamRegion {
  return (BLUEBEAM_REGIONS as readonly string[]).includes(value);
}

/** `full_prime` (create/manage sessions and files) + `offline_access` (a
 * refresh token comes back). Not `jobs` — this app never uses Bluebeam's
 * Automated Jobs feature. See the header comment for why `full_prime`
 * over `full_user`. */
export const BLUEBEAM_SCOPES = ["full_prime", "offline_access"] as const;

export const BLUEBEAM_ENV = {
  clientId: "BLUEBEAM_CLIENT_ID",
  clientSecret: "BLUEBEAM_CLIENT_SECRET",
  redirectUri: "BLUEBEAM_REDIRECT_URI",
  region: "BLUEBEAM_REGION",
} as const;

export interface BluebeamConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  region: BluebeamRegion;
  host: string;
}

type Env = Record<string, string | undefined>;

/** Null when anything required is missing, or `BLUEBEAM_REGION` is set to
 * something outside the five Bluebeam actually serves — never a guess at
 * which region a typo meant. Region defaults to `US` when unset, since
 * that is what every contractor this app targets is in. */
export function readBluebeamConfig(env: Env = process.env): BluebeamConfig | null {
  const clientId = env[BLUEBEAM_ENV.clientId]?.trim();
  const clientSecret = env[BLUEBEAM_ENV.clientSecret]?.trim();
  const redirectUri = env[BLUEBEAM_ENV.redirectUri]?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  const rawRegion = env[BLUEBEAM_ENV.region]?.trim();
  const region = rawRegion ? rawRegion.toUpperCase() : "US";
  if (!isBluebeamRegion(region)) return null;
  return { clientId, clientSecret, redirectUri, region, host: BLUEBEAM_REGION_HOSTS[region] };
}

/** The consent-screen URL. No PKCE: the quoted authorize example in
 * Bluebeam's own guide carries no `code_challenge`, and the token-exchange
 * example authenticates with `client_id`/`client_secret` in the body
 * rather than a Basic header — a confidential-client shape, same family as
 * CompanyCam's (see packages/integrations/src/companycam.ts for why that
 * is a legitimate choice rather than a shortcut). `state` is sent and
 * checked, which is the CSRF protection this flow needs regardless. */
export function bluebeamAuthorizeUrl(config: BluebeamConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: BLUEBEAM_SCOPES.join(" "),
    state,
  });
  return `${config.host}/oauth2/authorize?${params.toString()}`;
}

export interface BluebeamTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds, from the response's own `expires_in`. Bluebeam's guide says
   * 60 minutes; a missing or silly value here falls back to that. */
  expiresIn: number;
}

// Not exported: DocuSign's module already exports a `FetchLike` of the
// same shape, and re-exporting a second one under the same name from the
// barrel is a TS2308 build break (CLAUDE.md — two feature modules
// exporting the same type name). A caller outside this file that needs
// the shape uses `typeof fetch` directly, which is what it is.
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Thrown by the token endpoint. `invalidGrant` means the refresh token is
 * dead — expired (7 days unused) or revoked — and only a person
 * reconnecting fixes it. The message never contains a token. */
export class BluebeamAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly invalidGrant: boolean,
  ) {
    super(message);
    this.name = "BluebeamAuthError";
  }
}

async function tokenRequest(config: BluebeamConfig, fetchImpl: FetchLike, body: URLSearchParams): Promise<BluebeamTokens> {
  const response = await fetchImpl(`${config.host}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
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
    // The error CODE only: a token response body can hold a token, and
    // this message ends up in logs.
    const code = typeof parsed.error === "string" ? parsed.error : "unknown_error";
    throw new BluebeamAuthError(
      `Bluebeam token endpoint returned ${response.status} (${code})`,
      response.status,
      code === "invalid_grant",
    );
  }
  const accessToken = parsed.access_token;
  const refreshToken = parsed.refresh_token;
  const expiresIn = Number(parsed.expires_in);
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    throw new BluebeamAuthError("Bluebeam token endpoint answered without an access and refresh token", response.status, false);
  }
  return { accessToken, refreshToken, expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600 };
}

export function exchangeBluebeamCode(config: BluebeamConfig, code: string, fetchImpl: FetchLike = fetch): Promise<BluebeamTokens> {
  return tokenRequest(
    config,
    fetchImpl,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  );
}

export function refreshBluebeamTokens(config: BluebeamConfig, refreshToken: string, fetchImpl: FetchLike = fetch): Promise<BluebeamTokens> {
  return tokenRequest(
    config,
    fetchImpl,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      redirect_uri: config.redirectUri,
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Studio API — Sessions, Files, Markups                               */
/* ------------------------------------------------------------------ */

export interface BluebeamApiTarget {
  accessToken: string;
  host: string;
}

/** 401: the access token is expired or revoked. The caller refreshes once
 * and tries again — same shape as every other provider in this repo. */
export class BluebeamUnauthorizedError extends Error {
  constructor() {
    super("Bluebeam refused the access token (401)");
    this.name = "BluebeamUnauthorizedError";
  }
}

/** Anything else that went wrong, with a message safe to log and to show. */
export class BluebeamApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BluebeamApiError";
  }
}

async function apiError(response: Response): Promise<BluebeamApiError> {
  let message = "";
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    message = body.message ?? body.error ?? "";
  } catch {
    // Not JSON.
  }
  return new BluebeamApiError(`Bluebeam answered ${response.status}${message ? `: ${message}` : "."}`, response.status);
}

async function call(target: BluebeamApiTarget, path: string, init: RequestInit, fetchImpl: FetchLike): Promise<Response> {
  const response = await fetchImpl(`${target.host}/publicapi/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${target.accessToken}`, Accept: "application/json", ...(init.headers ?? {}) },
  });
  if (response.status === 401) throw new BluebeamUnauthorizedError();
  if (!response.ok) throw await apiError(response);
  return response;
}

/** Reads a string out of several possible key names — the permissive
 * parsing the header comment describes, so a wrong guess about which key
 * Bluebeam actually uses degrades instead of throwing. */
function pick(body: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export interface BluebeamSession {
  id: string;
  name: string;
}

/**
 * Create a Studio Session for one job's document exchange.
 *
 * SHAPE NOT INDEPENDENTLY VERIFIED — see the header comment. The request
 * body sends only `name`, which the guide confirms is a real field
 * ("Session name" is the first thing it lists); notification preferences,
 * access restriction and expiration are left at Bluebeam's own defaults
 * rather than guessed at, which the guide implies is a valid POST (it
 * lists them as configurable, not required). The response is read
 * permissively for an id under `id` or `sessionId`, and a name under
 * `name` or `sessionName` — whichever this account's Bluebeam actually
 * returns, one of those four reads it.
 */
export async function createBluebeamSession(target: BluebeamApiTarget, name: string, fetchImpl: FetchLike = fetch): Promise<BluebeamSession> {
  const response = await call(
    target,
    "/sessions",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) },
    fetchImpl,
  );
  const body = (await response.json()) as Record<string, unknown>;
  const id = pick(body, "id", "sessionId");
  if (!id) throw new BluebeamApiError("Bluebeam accepted the session but returned no session id.", response.status);
  return { id, name: pick(body, "name", "sessionName") ?? name };
}

export interface BluebeamSessionFile {
  id: string;
  name: string;
}

export async function listBluebeamSessionFiles(target: BluebeamApiTarget, sessionId: string, fetchImpl: FetchLike = fetch): Promise<BluebeamSessionFile[]> {
  const response = await call(target, `/sessions/${encodeURIComponent(sessionId)}/files`, { method: "GET" }, fetchImpl);
  const body = (await response.json()) as unknown;
  const rows = Array.isArray(body) ? body : Array.isArray((body as { items?: unknown[] })?.items) ? (body as { items: unknown[] }).items : [];
  const files: BluebeamSessionFile[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    const id = pick(record, "id", "fileId");
    if (!id) continue;
    files.push({ id, name: pick(record, "name", "fileName") ?? "Untitled file" });
  }
  return files;
}

/**
 * Upload one PDF into a session: create-metadata, PUT the bytes, confirm.
 * The three-step shape is Bluebeam's own description (the header
 * comment's quoted phrase); the exact request/response fields of each
 * step are NOT independently verified. Read `uploadUrl` permissively
 * (`uploadUrl` or `url`) and PUT the raw bytes there with no Authorization
 * header — a pre-signed S3 URL carries its own auth in the query string,
 * and forwarding a bearer token to a non-Bluebeam host would leak it.
 *
 * IF THE SANDBOX PROVES THE CONFIRM STEP WRONG: this is the one function
 * to fix. Everything upstream of it (OAuth, session create, file listing)
 * is independent of this guess.
 */
export async function uploadFileToBluebeamSession(
  target: BluebeamApiTarget,
  sessionId: string,
  file: { name: string; bytes: Uint8Array; contentType: string },
  fetchImpl: FetchLike = fetch,
): Promise<{ fileId: string }> {
  const created = await call(
    target,
    `/sessions/${encodeURIComponent(sessionId)}/files`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, fileName: file.name, byteSize: file.bytes.byteLength }),
    },
    fetchImpl,
  );
  const meta = (await created.json()) as Record<string, unknown>;
  const fileId = pick(meta, "id", "fileId");
  const uploadUrl = pick(meta, "uploadUrl", "url");
  if (!fileId || !uploadUrl) {
    throw new BluebeamApiError("Bluebeam did not return an upload target for this file.", created.status);
  }

  const putResponse = await fetchImpl(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.contentType },
    body: Buffer.from(file.bytes),
  });
  if (!putResponse.ok) {
    throw new BluebeamApiError(`Uploading the file to Bluebeam's storage answered ${putResponse.status}.`, putResponse.status);
  }

  await call(target, `/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fileId)}/confirm`, { method: "POST" }, fetchImpl);
  return { fileId };
}

export interface BluebeamMarkupSummary {
  total: number;
  /** Counts keyed by whatever string Bluebeam's `status` field holds
   * (e.g. "Approved", "Rejected") — never assumed to be a fixed enum,
   * since that field's exact vocabulary is one of the unverified shapes. */
  byStatus: Record<string, number>;
}

/** A count of markups in a session, grouped by their status field — the
 * closest this API gets to "is the GC done marking this up", per the
 * header comment: Bluebeam's Studio API exposes markup STATUS, not
 * markup geometry or takeoff quantities. */
export async function summarizeBluebeamSessionMarkups(target: BluebeamApiTarget, sessionId: string, fetchImpl: FetchLike = fetch): Promise<BluebeamMarkupSummary> {
  const response = await call(target, `/sessions/${encodeURIComponent(sessionId)}/markups`, { method: "GET" }, fetchImpl);
  const body = (await response.json()) as unknown;
  const rows = Array.isArray(body) ? body : Array.isArray((body as { items?: unknown[] })?.items) ? (body as { items: unknown[] }).items : [];
  const byStatus: Record<string, number> = {};
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const status = pick(row as Record<string, unknown>, "status", "markupStatus") ?? "Unknown";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  return { total: rows.length, byStatus };
}
