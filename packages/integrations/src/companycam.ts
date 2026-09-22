// CompanyCam — OAuth 2.0 and a READ-ONLY REST client, for importing a
// CompanyCam project's photos into a C Stream job's gallery.
//
// READ-ONLY IS STRUCTURAL, NOT A PROMISE — the same design as procore.ts.
// The only function here that talks to CompanyCam's API is `companyCamGet`,
// and its method is the literal "GET"; there is no parameter that could
// make it anything else. The only POSTs are to CompanyCam's OAuth token
// endpoint, which is how every OAuth client obtains a token and changes
// nothing in anybody's account. On top of that, the token is requested
// with scope `read` ONLY, so even a bug that somehow built a write request
// would be refused by CompanyCam itself. `companycam-client.test.ts`
// records every request the client makes and fails on any non-GET to the
// API host.
//
// Sources: see the notes at the bottom for which facts were read from
// CompanyCam's current docs and which were not.

type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The env var names, in one place, so the "not set up" card and the setup
 * steps name the same things. */
export const COMPANYCAM_ENV = {
  clientId: "COMPANYCAM_CLIENT_ID",
  clientSecret: "COMPANYCAM_CLIENT_SECRET",
  redirectUri: "COMPANYCAM_REDIRECT_URI",
} as const;

/**
 * CompanyCam has no sandbox environment (nothing in its docs describes
 * one), so unlike Procore there is no host table to pick from — one login
 * host, one API host. A developer tests against their own real CompanyCam
 * account, which their docs say needs a Pro, Premium or Elite plan.
 */
export const COMPANYCAM_HOSTS = {
  /** OAuth authorize + token, and the web app. */
  app: "https://app.companycam.com",
  /** REST API v2. */
  api: "https://api.companycam.com",
} as const;

export interface CompanyCamConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Null when any required variable is missing — never a throw, so a page
 * can ask "is this set up?" without a try/catch. */
export function readCompanyCamConfig(env: Env = process.env): CompanyCamConfig | null {
  const clientId = env[COMPANYCAM_ENV.clientId]?.trim();
  const clientSecret = env[COMPANYCAM_ENV.clientSecret]?.trim();
  const redirectUri = env[COMPANYCAM_ENV.redirectUri]?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

/**
 * The consent-screen URL. Scope is `read` and nothing else — CompanyCam's
 * scopes are `read`, `write` and `destroy`, and an import never needs the
 * other two; not asking is a stronger guarantee than promising not to use
 * them. No PKCE: CompanyCam's OAuth doc describes the plain
 * authorization-code grant with a client secret and does not mention PKCE,
 * and unlike Procore (whose docs invite extra params) there is no
 * published behaviour to lean on for unknown parameters — `state` is sent
 * and checked, which is the CSRF protection this flow needs.
 */
export function companyCamAuthorizeUrl(config: CompanyCamConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "read",
    state,
  });
  return `${COMPANYCAM_HOSTS.app}/oauth/authorize?${params.toString()}`;
}

export interface CompanyCamTokens {
  accessToken: string;
  refreshToken: string;
  /** From `expires_in` (7200s in CompanyCam's documented example) +
   * `created_at` (or now). Null when CompanyCam did not say. */
  expiresAt: Date | null;
}

/** Thrown by the token endpoint. `invalidGrant` means the refresh token is
 * dead (used, revoked) and only a person reconnecting fixes it. The
 * message never contains a token. */
export class CompanyCamAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly invalidGrant: boolean,
  ) {
    super(message);
    this.name = "CompanyCamAuthError";
  }
}

async function tokenRequest(
  config: CompanyCamConfig,
  fetchImpl: FetchLike,
  body: URLSearchParams,
  now: () => Date,
): Promise<CompanyCamTokens> {
  const response = await fetchImpl(`${COMPANYCAM_HOSTS.app}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Not JSON — handled below by the missing fields.
  }
  if (!response.ok) {
    // The error CODE only — a token response body can hold a token, and
    // this message ends up in logs.
    const code = typeof parsed.error === "string" ? parsed.error : "unknown_error";
    throw new CompanyCamAuthError(
      `CompanyCam token endpoint returned ${response.status} (${code})`,
      response.status,
      code === "invalid_grant",
    );
  }
  const accessToken = typeof parsed.access_token === "string" ? parsed.access_token : null;
  const refreshToken = typeof parsed.refresh_token === "string" ? parsed.refresh_token : null;
  if (!accessToken || !refreshToken) {
    throw new CompanyCamAuthError("CompanyCam token response was missing a token", response.status, false);
  }
  const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : Number(parsed.expires_in);
  const createdAt = typeof parsed.created_at === "number" ? parsed.created_at : null;
  const issued = createdAt ? createdAt * 1000 : now().getTime();
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(issued + expiresIn * 1000) : null;
  return { accessToken, refreshToken, expiresAt };
}

export function exchangeCompanyCamCode(
  config: CompanyCamConfig,
  code: string,
  fetchImpl: FetchLike = fetch,
  now: () => Date = () => new Date(),
): Promise<CompanyCamTokens> {
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
    now,
  );
}

/**
 * CompanyCam's OAuth doc says every refresh returns a NEW refresh_token and
 * tells you to store both — treated here as single-use, exactly like
 * Procore's, so the caller must compare-and-swap the new pair. See
 * apps/web/lib/companycam/connection.ts.
 */
export function refreshCompanyCamTokens(
  config: CompanyCamConfig,
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
  now: () => Date = () => new Date(),
): Promise<CompanyCamTokens> {
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
    now,
  );
}

/* ------------------------------------------------------------------ */
/* REST                                                                */
/* ------------------------------------------------------------------ */

/** 401: the access token is expired or revoked. The caller refreshes once
 * and tries again. */
export class CompanyCamUnauthorizedError extends Error {
  constructor() {
    super("CompanyCam refused the access token (401)");
    this.name = "CompanyCamUnauthorizedError";
  }
}

/** Anything else that went wrong, with a message safe to log and to show:
 * it names what failed, never a token or a payload. */
export class CompanyCamApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyCamApiError";
  }
}

/** How many times one request is retried after a 429/503. */
export const COMPANYCAM_MAX_RETRIES = 3;
/** Longest single wait, so a far-off reset cannot park a Server Action. */
export const COMPANYCAM_MAX_WAIT_MS = 15_000;

/**
 * How long to wait after a 429 or 503. CompanyCam's docs publish NO rate
 * limit and name no reset header (checked 2026-09-19), so this honours a
 * standard Retry-After if one arrives and otherwise backs off a flat five
 * seconds with jitter, capped.
 */
export function companyCamRateLimitWaitMs(headers: Headers): number {
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(COMPANYCAM_MAX_WAIT_MS, retryAfter * 1000);
  return 5_000 + Math.floor(Math.random() * 250);
}

export type CompanyCamRequestDeps = {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Query = Record<string, string | number | undefined>;

/** THE one call to CompanyCam's API. GET, always — the method is a literal. */
export async function companyCamGet(
  accessToken: string,
  path: string,
  query: Query = {},
  deps: CompanyCamRequestDeps = {},
): Promise<{ body: unknown; headers: Headers }> {
  if (!path.startsWith("/v2/")) throw new CompanyCamApiError(`Refusing a CompanyCam path outside /v2/: ${path}`);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  const url = `${COMPANYCAM_HOSTS.api}${path}${qs ? `?${qs}` : ""}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, { method: "GET", headers });

    if (response.status === 401) throw new CompanyCamUnauthorizedError();
    if (response.status === 403) {
      throw new CompanyCamApiError(
        `CompanyCam wouldn't show ${describePath(path)} to C Stream — the connected login may not have access to it.`,
      );
    }
    if (response.status === 429 || response.status === 503) {
      if (attempt >= COMPANYCAM_MAX_RETRIES) {
        throw new CompanyCamApiError(
          response.status === 429
            ? "CompanyCam is limiting how fast C Stream can read right now. Wait a few minutes and try again."
            : "CompanyCam is busy right now. Wait a few minutes and try again.",
        );
      }
      await sleep(companyCamRateLimitWaitMs(response.headers));
      continue;
    }
    if (response.status === 404) {
      throw new CompanyCamApiError(`CompanyCam couldn't find ${describePath(path)} — it may have been removed.`);
    }
    if (!response.ok) throw new CompanyCamApiError(`CompanyCam answered ${response.status} for ${describePath(path)}.`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CompanyCamApiError(`CompanyCam's answer for ${describePath(path)} wasn't readable.`);
    }
    return { body, headers: response.headers };
  }
}

function describePath(path: string): string {
  if (path.includes("photos")) return "photos";
  if (path.includes("projects")) return "the project list";
  return "that";
}

export type CompanyCamPageResult<T> = { items: T[]; truncated: boolean };

/**
 * Every page of one list, by `page`/`per_page` (offset pagination —
 * CompanyCam also offers cursor pagination via X-Next-Cursor, but the two
 * must not be mixed and page numbers are what the import's "press again
 * for the rest" resume needs). Stops at the last page or at `limit` items,
 * whichever comes first; `truncated` says which.
 *
 * The last page is detected two independent ways, either of which stops
 * the walk: fewer than `per_page` rows back, or the documented
 * `X-Has-Next: false` header. A server that ignored `page` and kept
 * answering page 1 would otherwise loop forever, so a hard page ceiling
 * stops it with an error — the same guard procoreAllPages carries.
 */
export async function companyCamAllPages<T>(
  accessToken: string,
  path: string,
  options: { perPage: number; limit: number; startPage?: number; query?: Query },
  deps: CompanyCamRequestDeps = {},
): Promise<CompanyCamPageResult<T>> {
  const items: T[] = [];
  const first = options.startPage ?? 1;
  const maxPages = Math.ceil(options.limit / options.perPage) + 1;
  for (let page = first; page < first + maxPages; page++) {
    const { body, headers } = await companyCamGet(
      accessToken,
      path,
      { ...options.query, page, per_page: options.perPage },
      deps,
    );
    if (!Array.isArray(body)) throw new CompanyCamApiError(`CompanyCam's answer for ${describePath(path)} was not a list.`);
    for (const item of body as T[]) {
      if (items.length >= options.limit) return { items, truncated: true };
      items.push(item);
    }
    const hasNext = headers.get("x-has-next");
    const done = body.length === 0 || body.length < options.perPage || hasNext === "false";
    if (done) return { items, truncated: false };
    if (items.length >= options.limit) return { items, truncated: true };
  }
  throw new CompanyCamApiError(`CompanyCam's ${describePath(path)} list did not end where it said it would.`);
}

/* ------------------------------------------------------------------ */
/* What is read                                                        */
/* ------------------------------------------------------------------ */

type Raw = Record<string, unknown>;

function str(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export type CompanyCamProject = {
  id: string;
  name: string;
  /** One display line of the project's address, or null. */
  address: string | null;
};

export type CompanyCamPhotoUri = { type: string; uri: string };

export type CompanyCamPhoto = {
  id: string;
  projectId: string | null;
  /** Unix seconds from `captured_at`, as a Date. Null when absent. */
  capturedAt: Date | null;
  creatorName: string | null;
  /** CompanyCam's photo description, or null. */
  description: string | null;
  /** pending | processing | processed | processing_error | duplicate —
   * the import only takes `processed`, so a placeholder is never stored. */
  processingStatus: string | null;
  uris: CompanyCamPhotoUri[];
};

function normaliseProject(raw: Raw): CompanyCamProject | null {
  const id = str(raw.id);
  if (!id) return null;
  const address = raw.address && typeof raw.address === "object" ? (raw.address as Raw) : null;
  const line = address
    ? [str(address.street_address_1), str(address.city), str(address.state)].filter(Boolean).join(", ") || null
    : null;
  return { id, name: str(raw.name) ?? `CompanyCam project ${id}`, address: line };
}

export function normaliseCompanyCamPhoto(raw: Raw): CompanyCamPhoto | null {
  const id = str(raw.id);
  if (!id) return null;
  const captured = typeof raw.captured_at === "number" && raw.captured_at > 0 ? new Date(raw.captured_at * 1000) : null;
  const uris = Array.isArray(raw.uris)
    ? (raw.uris as Raw[])
        .map((u) => ({ type: str(u.type), uri: str(u.uri) ?? str(u.url) }))
        .filter((u): u is CompanyCamPhotoUri => Boolean(u.type && u.uri))
    : [];
  return {
    id,
    projectId: str(raw.project_id),
    capturedAt: captured,
    creatorName: str(raw.creator_name),
    description: str(raw.description),
    processingStatus: str(raw.processing_status),
    uris,
  };
}

/**
 * Which file to download for the gallery: the `web` variant (a processed,
 * browser-renderable image) over `original` (which can be an HEIC straight
 * off the phone at full size), over whatever else is listed.
 */
export function companyCamDownloadUri(photo: CompanyCamPhoto): string | null {
  const byType = (type: string) => photo.uris.find((u) => u.type === type)?.uri ?? null;
  return byType("web") ?? byType("original") ?? photo.uris[0]?.uri ?? null;
}

/** The active projects this CompanyCam account can see, for the Link
 * picker. `status=active` keeps deleted projects out of a picker that
 * exists to receive new photos. */
export async function listCompanyCamProjects(
  accessToken: string,
  deps: CompanyCamRequestDeps = {},
): Promise<{ projects: CompanyCamProject[]; truncated: boolean }> {
  const { items, truncated } = await companyCamAllPages<Raw>(
    accessToken,
    "/v2/projects",
    { perPage: 100, limit: 500, query: { status: "active" } },
    deps,
  );
  const projects = items.map(normaliseProject).filter((p): p is CompanyCamProject => p !== null);
  return { projects, truncated };
}

/**
 * One page of one project's photos, oldest-first import order left to the
 * caller — CompanyCam answers newest-first and the import dedupes by photo
 * id, so order only affects which photos arrive in the FIRST batch.
 * Deleted photos are filtered out here (their `status` is "deleted");
 * processing state is left to the caller, which skips a photo whose file
 * is not ready rather than importing a placeholder.
 */
export async function fetchCompanyCamPhotoPage(
  accessToken: string,
  projectId: string,
  page: number,
  perPage: number,
  deps: CompanyCamRequestDeps = {},
): Promise<{ photos: CompanyCamPhoto[]; hasNext: boolean }> {
  const { body, headers } = await companyCamGet(
    accessToken,
    "/v2/photos",
    { project_ids: projectId, page, per_page: perPage },
    deps,
  );
  if (!Array.isArray(body)) throw new CompanyCamApiError("CompanyCam's answer for photos was not a list.");
  const raws = body as Raw[];
  const photos = raws
    .filter((raw) => str(raw.status) !== "deleted")
    .map(normaliseCompanyCamPhoto)
    .filter((p): p is CompanyCamPhoto => p !== null);
  const hasNext = headers.get("x-has-next") !== "false" && raws.length >= perPage;
  return { photos, hasNext };
}

/* ------------------------------------------------------------------ *
 * API notes — what was VERIFIED against CompanyCam's docs and what was
 * not, so the next person patches facts instead of re-deriving them.
 *
 * Verified 2026-09-19, from https://companycam.readme.io (the llms.txt
 * index, docs/oauth.md, reference/listprojects.md, reference/listphotos.md,
 * reference/getphoto.md, docs/defining-the-current-user.md):
 *   - OAuth authorize: https://app.companycam.com/oauth/authorize; token:
 *     https://app.companycam.com/oauth/token; scopes `read write destroy`;
 *     authorization-code and refresh-token grants; each refresh returns a
 *     new refresh_token; access tokens ~7200s in the documented example.
 *   - App registration is SELF-SERVE at
 *     https://app.companycam.com/access-keys/applications — no partner
 *     programme gate. API access requires a Pro/Premium/Elite CompanyCam
 *     plan on the ACCOUNT (that gates customers' plans, not us).
 *   - API base https://api.companycam.com/v2; Bearer auth.
 *   - GET /v2/projects: page/per_page, `query`, `status` (active|deleted),
 *     `modified_since`; project has id, name, address{street_address_1,
 *     city, state, postal_code}, status, archived.
 *   - GET /v2/photos: page/per_page (default 50, max 100) OR cursor
 *     `after`/`before` from X-Next-Cursor/X-Prev-Cursor — the two must not
 *     be mixed; X-Has-Next/X-Has-Prev headers; filter `project_ids`;
 *     photo has id, project_id, captured_at/created_at (unix seconds),
 *     creator_name, description, status (active|deleted),
 *     processing_status (pending|processing|processed|processing_error|
 *     duplicate), uris[{type: original|web|thumbnail, uri, url}],
 *     coordinates{lat,lon}, hash.
 *
 * NOT verified, and how this file behaves about each:
 *   - Rate limits: the docs publish none. 429/503 are retried with
 *     Retry-After when present, else a flat 5s, three times.
 *   - PKCE support: not mentioned; not sent (state only).
 *   - A "current user" endpoint: docs/defining-the-current-user.md is
 *     about the X_COMPANYCAM_USER write header, not a /me endpoint, so
 *     the connect flow does not fetch one — the card labels the
 *     connection "CompanyCam account" rather than a name it cannot get.
 *   - Whether `uris[].uri` URLs need auth to download: assumed public
 *     (they are the URLs CompanyCam's own web app renders); the import
 *     sends no Authorization header to them, on purpose — a bearer token
 *     must not be sprayed at an arbitrary CDN host.
 *   - The legacy-API deprecation banner ("deprecating early 2027", new
 *     portal at developers.companycam.com) — the new portal served no
 *     readable content on 2026-09-19. Everything above is the CURRENT
 *     published reference; revisit before 2027.
 * ------------------------------------------------------------------ */
export const COMPANYCAM_API_NOTES_VERIFIED_ON = "2026-09-19";
