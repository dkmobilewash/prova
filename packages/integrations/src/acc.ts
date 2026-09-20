// Autodesk Construction Cloud (ACC) — OAuth 2.0 (Autodesk Platform Services,
// "APS", formerly Forge) and a READ-ONLY REST client, for a feed of a GC's
// RFIs and submittals into a subcontractor's job.
//
// SAME SHAPE AS packages/integrations/src/procore.ts — read that file first;
// this one only explains where ACC differs and what is different about how
// sure we are of each fact.
//
// READ-ONLY IS STRUCTURAL, NOT A PROMISE, same as Procore. The only function
// here that talks to ACC's API is `accGet`, and its method is the literal
// "GET" — there is no parameter that could make it anything else. The only
// POSTs are to APS's own OAuth token endpoint. `acc-client.test.ts` records
// every request the client makes and fails on any non-GET to an API host, and
// on any path outside the small allowlist this file actually reads.
//
// NO OAUTH SCOPE REQUESTED HERE EVER INCLUDES A WRITE SCOPE (`data:write`,
// `account:write`, …). That is a second, independent lock on top of the
// GET-only client: even if a bug someday added a POST/PUT/PATCH call, the
// token itself would not be authorised to use it.
//
// Sources: see the notes at the bottom of this file for what was read from
// Autodesk's own docs this session, what is standard, widely-documented APS
// behaviour that could not be re-confirmed from a primary source in this
// session (the docs portal renders in JavaScript — a plain fetch of a page
// returns only navigation, the same problem procore.ts's notes describe for
// developers.procore.com), and what is a best-effort guess that should be
// checked against a real ACC sandbox before this goes live.

type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The env var names, in one place, so the "not set up" card and the setup
 * steps name the same things. */
export const ACC_ENV = {
  clientId: "ACC_CLIENT_ID",
  clientSecret: "ACC_CLIENT_SECRET",
  redirectUri: "ACC_REDIRECT_URI",
} as const;

/**
 * ONE set of hosts. Unlike Procore, APS has no separate sandbox login/API
 * host that a developer app points at instead of production — the same
 * `developer.api.autodesk.com` serves every APS app, and what an app can see
 * is scoped by which ACC accounts have added it (see the notes at the
 * bottom) rather than by which host it calls. So there is no
 * ACC_ENVIRONMENT env var to mirror Procore's.
 */
export const ACC_HOSTS = {
  /** OAuth authorize + token (Authentication v2). */
  auth: "https://developer.api.autodesk.com/authentication/v2",
  /** REST API — Data Management, the construction APIs, the profile
   * endpoint. All under the same host. */
  api: "https://developer.api.autodesk.com",
  /** The ACC web app, for "Open in ACC" links. */
  web: "https://acc.autodesk.com",
} as const;

export interface AccConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Null when any required variable is missing — never a throw, so a page
 * can ask "is this set up?" without a try/catch. */
export function readAccConfig(env: Env = process.env): AccConfig | null {
  const clientId = env[ACC_ENV.clientId]?.trim();
  const clientSecret = env[ACC_ENV.clientSecret]?.trim();
  const redirectUri = env[ACC_ENV.redirectUri]?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

/**
 * The scopes this app ever requests — read-only, always, both as a promise
 * and as a technical limit: a token issued with only these scopes cannot
 * call a write endpoint even if this client were later changed to try.
 * `data:read` covers Data Management (hubs/projects) and is believed to
 * cover the construction APIs too (VERIFIED for Data Management, NOT
 * independently verified for Issues/RFIs/Submittals this session — see the
 * notes at the bottom). `account:read` is requested so the profile and hub
 * listing can name which ACC account a project belongs to.
 */
export const ACC_SCOPE = "data:read account:read" as const;

/**
 * The consent-screen URL. PKCE (S256) is REQUIRED by APS's v2 authorize
 * endpoint for the authorization-code grant (VERIFIED), unlike Procore where
 * it is sent speculatively. `scope` is sent because, unlike Procore, APS
 * tokens genuinely carry an OAuth scope.
 */
export function accAuthorizeUrl(config: AccConfig, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: ACC_SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${ACC_HOSTS.auth}/authorize?${params.toString()}`;
}

export interface AccTokens {
  accessToken: string;
  refreshToken: string;
  /** From `expires_in`. Null when APS did not say. */
  expiresAt: Date | null;
}

/** Thrown by the token endpoint. `invalidGrant` means the refresh token is
 * dead (expired — APS's are valid 15 days, VERIFIED — revoked, or already
 * rotated) and only a person reconnecting fixes it. The message never
 * contains a token. */
export class AccAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly invalidGrant: boolean,
  ) {
    super(message);
    this.name = "AccAuthError";
  }
}

/**
 * Confidential (server) apps authenticate the token request with HTTP Basic
 * auth (`client_id:client_secret`) rather than putting the secret in the
 * form body — VERIFIED: APS's own docs say "Traditional Web Apps and
 * Server-to-Server Apps should use the Authorization header with Basic
 * Authentication" for this grant. C Stream is exactly that kind of app.
 */
function basicAuthHeader(config: AccConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64")}`;
}

async function tokenRequest(
  config: AccConfig,
  fetchImpl: FetchLike,
  body: URLSearchParams,
  now: () => Date,
): Promise<AccTokens> {
  const response = await fetchImpl(`${ACC_HOSTS.auth}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: basicAuthHeader(config),
    },
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
    // The error CODE only — the body of a token response can hold a token,
    // and this message ends up in logs.
    const code = typeof parsed.error === "string" ? parsed.error : "unknown_error";
    throw new AccAuthError(
      `APS token endpoint returned ${response.status} (${code})`,
      response.status,
      code === "invalid_grant",
    );
  }
  const accessToken = parsed.access_token;
  const refreshToken = parsed.refresh_token;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    throw new AccAuthError("APS token endpoint answered without an access and refresh token", response.status, false);
  }
  const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : Number(parsed.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now().getTime() + expiresIn * 1000) : null;
  return { accessToken, refreshToken, expiresAt };
}

export function exchangeAccCode(
  config: AccConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike = fetch,
  now: () => Date = () => new Date(),
): Promise<AccTokens> {
  return tokenRequest(
    config,
    fetchImpl,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    }),
    now,
  );
}

/**
 * NOT VERIFIED this session whether APS rotates refresh tokens on every use
 * (Procore's do — single-use; Jobber's do too) or reissues the same one.
 * Handled the safe way either way: the caller always stores whatever comes
 * back, under the same compare-and-swap Procore and Jobber use, so a stale
 * write from a losing concurrent refresh can never overwrite a winner's —
 * see apps/web/lib/acc/connection.ts.
 */
export function refreshAccTokens(
  config: AccConfig,
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
  now: () => Date = () => new Date(),
): Promise<AccTokens> {
  return tokenRequest(
    config,
    fetchImpl,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    now,
  );
}

/* ------------------------------------------------------------------ */
/* REST                                                                */
/* ------------------------------------------------------------------ */

/** 401: the access token is expired or revoked. The caller refreshes once
 * and tries again. */
export class AccUnauthorizedError extends Error {
  constructor() {
    super("Autodesk refused the access token (401)");
    this.name = "AccUnauthorizedError";
  }
}

/** 403: this login cannot read this. Two causes, the same shape as
 * Procore's: the GC's ACC ACCOUNT has not added this app as a Custom
 * Integration (Account Admin → Custom Integrations — an account admin's
 * step, not a project one; VERIFIED this is a real, named ACC admin
 * surface), or the signed-in user's own project membership does not include
 * this tool. Either way the GC fixes it, not a reconnect, and it is no
 * reason to stop reading the other tool. */
export class AccForbiddenError extends Error {
  constructor(what: string) {
    super(
      `Autodesk Construction Cloud wouldn't show ${what} to C Stream. Either the GC hasn't added the C Stream app under their ACC account's Custom Integrations yet, or your login's project membership doesn't include that tool — both are fixed on the GC's side.`,
    );
    this.name = "AccForbiddenError";
  }
}

/** Anything else that went wrong, with a message safe to log and to show:
 * it names what failed, never a token or a payload. */
export class AccApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccApiError";
  }
}

/** How many times one request is retried after a 429. */
export const ACC_MAX_RETRIES = 3;
/** Longest single wait, so a far-off reset cannot park a Server Action. */
export const ACC_MAX_WAIT_MS = 15_000;

/**
 * How long to wait after a 429. VERIFIED: APS's rate-limited responses carry
 * a `Retry-After` header in seconds — a single, simpler mechanism than
 * Procore's (which also has an epoch-seconds reset header). Capped, and
 * never below half a second, plus jitter so two tabs do not retry in
 * lockstep.
 */
export function accRateLimitWaitMs(headers: Headers): number {
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(ACC_MAX_WAIT_MS, Math.max(500, retryAfter * 1000) + Math.floor(Math.random() * 250));
  }
  return 5_000;
}

export type AccRequestDeps = {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Query = Record<string, string | number | undefined>;

/**
 * Path prefixes this client will ever call. Anything else is refused before
 * a request is made — the same belt Procore's `/rest/` check wears, sized to
 * the handful of API families this feed actually reads: Data Management
 * (hubs/projects), the profile endpoint, and the two construction APIs.
 */
const ALLOWED_PATH_PREFIXES = [
  "/project/v1/hubs",
  "/userprofile/v1/users/@me",
  "/construction/rfis/v2/",
  "/construction/submittals/v2/",
] as const;

/**
 * THE one call to Autodesk's API. GET, always — the method is a literal.
 */
export async function accGet(
  config: AccConfig,
  accessToken: string,
  path: string,
  query: Query = {},
  deps: AccRequestDeps = {},
): Promise<{ body: unknown; headers: Headers }> {
  if (!ALLOWED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    throw new AccApiError(`Refusing an Autodesk path outside the allowed read paths: ${path}`);
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  const url = `${ACC_HOSTS.api}${path}${qs ? `?${qs}` : ""}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, { method: "GET", headers });

    if (response.status === 401) throw new AccUnauthorizedError();
    if (response.status === 403) throw new AccForbiddenError(describePath(path));
    if (response.status === 429) {
      if (attempt >= ACC_MAX_RETRIES) {
        throw new AccApiError("Autodesk is limiting how fast C Stream can read right now. Wait a few minutes and press Refresh.");
      }
      await sleep(accRateLimitWaitMs(response.headers));
      continue;
    }
    if (response.status === 404) {
      throw new AccApiError(`Autodesk couldn't find ${describePath(path)} — it may have been removed, or you were taken off the project.`);
    }
    if (!response.ok) throw new AccApiError(`Autodesk answered ${response.status} for ${describePath(path)}.`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AccApiError(`Autodesk's answer for ${describePath(path)} wasn't readable.`);
    }
    return { body, headers: response.headers };
  }
}

function describePath(path: string): string {
  if (path.includes("/rfis")) return "RFIs";
  if (path.includes("/submittals")) return "submittals";
  if (path.includes("/hubs")) return "the account/project list";
  if (path.includes("/users/@me")) return "your profile";
  return "that";
}

export type AccPageResult<T> = { items: T[]; truncated: boolean };

/**
 * Both construction APIs read here (RFIs, Submittals) are paginated by
 * `limit`/`offset` with a response envelope of `{ results: [...], pagination:
 * { limit, offset, totalResults } }` — VERIFIED for the Issues API, which
 * this feed does not read; ASSUMED (NOT independently verified this session)
 * to be the same for RFIs v2 and Submittals v2, since they are the same
 * "construction" API family and every documented list among them follows
 * this shape. Parsing is defensive rather than trusting the assumption
 * blindly: it also accepts a bare array (`data`) or a `data` field, and
 * throws a clear, nameable error rather than silently returning nothing if
 * neither shape is found — so a wrong guess fails loudly in
 * acc-client.test.ts and in a real refresh's status line, not silently.
 */
export async function accAllPages<T>(
  config: AccConfig,
  accessToken: string,
  path: string,
  options: { perPage: number; limit: number; query?: Query },
  deps: AccRequestDeps = {},
): Promise<AccPageResult<T>> {
  const items: T[] = [];
  const maxPages = Math.ceil(options.limit / options.perPage) + 1;
  for (let page = 0; page < maxPages; page++) {
    const offset = page * options.perPage;
    const { body } = await accGet(config, accessToken, path, { ...options.query, limit: options.perPage, offset }, deps);
    const { rows, total } = readListEnvelope<T>(body, path);
    for (const item of rows) {
      if (items.length >= options.limit) return { items, truncated: true };
      items.push(item);
    }
    const done = rows.length === 0 || rows.length < options.perPage || (total !== null && offset + rows.length >= total);
    if (done) return { items, truncated: false };
    if (items.length >= options.limit) return { items, truncated: true };
  }
  throw new AccApiError(`Autodesk's ${describePath(path)} list did not end where it said it would.`);
}

function readListEnvelope<T>(body: unknown, path: string): { rows: T[]; total: number | null } {
  if (Array.isArray(body)) return { rows: body as T[], total: null };
  if (body && typeof body === "object") {
    const raw = body as Record<string, unknown>;
    const rows = Array.isArray(raw.results) ? raw.results : Array.isArray(raw.data) ? raw.data : null;
    if (rows) {
      const pagination = raw.pagination && typeof raw.pagination === "object" ? (raw.pagination as Record<string, unknown>) : null;
      const total = pagination && typeof pagination.totalResults === "number" ? pagination.totalResults : null;
      return { rows: rows as T[], total };
    }
  }
  throw new AccApiError(`Autodesk's answer for ${describePath(path)} was not a list this client understands.`);
}

/* ------------------------------------------------------------------ */
/* What is read                                                        */
/* ------------------------------------------------------------------ */

export type AccHub = { id: string; name: string };
export type AccProject = { id: string; name: string; hubId: string; hubName: string };

type Raw = Record<string, unknown>;

function str(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Data Management ids are prefixed ("b.<uuid>" for an ACC/BIM 360 hub or
 * project) but the construction APIs (Issues/RFIs/Submittals, Account
 * Admin) take the bare id without that prefix. NOT independently verified
 * from a primary Autodesk doc this session (the reference pages render in
 * JavaScript — see the notes at the bottom) — this is standard, widely
 * documented APS behaviour (every "Hubs Browser" sample strips it the same
 * way) rather than a guess invented here, but it is exactly the kind of
 * fact to click-test against a real hub before this goes live.
 */
function stripHubPrefix(id: string): string {
  return id.replace(/^b\./, "");
}

/** JSON:API `data[].id`/`.attributes.name`, the shape Data Management uses
 * (VERIFIED: the hubs/projects endpoints are documented as returning a
 * collection under `data`). */
function jsonApiRows(body: unknown): Raw[] {
  if (body && typeof body === "object" && Array.isArray((body as Raw).data)) return (body as Raw).data as Raw[];
  return [];
}

/** The ACC/BIM 360 hubs (accounts) this login belongs to — for a sub,
 * typically their own account plus each GC's that invited them. Hubs of
 * other APS product types (Fusion Team, "a." ids) are filtered out: they
 * are not construction accounts and have no Issues/RFIs/Submittals to read. */
export async function listAccHubs(config: AccConfig, accessToken: string, deps: AccRequestDeps = {}): Promise<AccHub[]> {
  const { body } = await accGet(config, accessToken, "/project/v1/hubs", {}, deps);
  return jsonApiRows(body)
    .filter((raw) => typeof raw.id === "string" && raw.id.startsWith("b."))
    .map((raw) => {
      const attributes = (raw.attributes && typeof raw.attributes === "object" ? raw.attributes : {}) as Raw;
      return { id: stripHubPrefix(raw.id as string), name: str(attributes.name) ?? `ACC account ${raw.id}` };
    });
}

/** The projects in one hub that this login can see. Every project the API
 * returns is accepted — NOT VERIFIED which `attributes.extension.type`
 * values would distinguish an active construction project from something
 * else this hub might list, so nothing here filters on it rather than
 * guessing at a value that could silently hide real projects. */
export async function listAccProjects(config: AccConfig, accessToken: string, hub: AccHub, deps: AccRequestDeps = {}): Promise<AccProject[]> {
  const { body } = await accGet(config, accessToken, `/project/v1/hubs/b.${hub.id}/projects`, {}, deps);
  return jsonApiRows(body).map((raw) => {
    const attributes = (raw.attributes && typeof raw.attributes === "object" ? raw.attributes : {}) as Raw;
    const id = typeof raw.id === "string" ? stripHubPrefix(raw.id) : String(raw.id ?? "");
    return { id, name: str(attributes.name) ?? `ACC project ${id}`, hubId: hub.id, hubName: hub.name };
  });
}

/** Who this token belongs to, for the card's "Account" line. A well-known,
 * stable APS endpoint used broadly across Autodesk's own sample apps —
 * VERIFIED as a real path, response field names NOT independently
 * re-confirmed this session, so both common spellings are tried. */
export async function fetchAccMe(config: AccConfig, accessToken: string, deps: AccRequestDeps = {}): Promise<{ id: string; name: string }> {
  const { body } = await accGet(config, accessToken, "/userprofile/v1/users/@me", {}, deps);
  const raw = (body && typeof body === "object" ? body : {}) as Raw;
  const id = str(raw.userId) ?? str(raw.sub) ?? str(raw.uid);
  if (!id) throw new AccApiError("Autodesk did not say whose login this is.");
  const name = str(raw.name) ?? str(raw.userName) ?? [str(raw.firstName), str(raw.lastName)].filter(Boolean).join(" ").trim();
  return { id, name: name || "Autodesk user" };
}

export type AccFeedKind = "RFI" | "SUBMITTAL";

/** One GC record, normalised. Dates are calendar days (YYYY-MM-DD) or ISO
 * instants, never parsed further here. */
export type AccFeedItem = {
  kind: AccFeedKind;
  accId: string;
  number: string | null;
  title: string;
  status: string | null;
  revision: string | null;
  discipline: string | null;
  ballInCourt: string | null;
  dueDate: string | null;
  updatedAt: string | null;
  webUrl: string;
};

function day(value: unknown): string | null {
  const s = str(value);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** ACC most often names an assignee as a raw id or a name string depending
 * on the field; both are tried and only a plausible display string is kept. */
function assignee(raw: Raw): string | null {
  const candidates = [raw.assignedTo, raw.responsibleContractor, raw.respondent];
  for (const value of candidates) {
    const name = str(value);
    if (name) return name;
  }
  return null;
}

/** Links are BUILT from ids and the configured web host — never copied from
 * a payload — so every "Open in ACC" link points at ACC's own site. Path
 * shape NOT independently verified this session (the same JS-rendering
 * limitation as the rest of this file's notes): current best understanding
 * of ACC's own URL scheme, to be confirmed against a real project before
 * go-live — a wrong link still opens ACC's project, just not the one exact
 * item, which is a materially safer failure than a wrong API read. */
export function accWebUrl(kind: AccFeedKind, accProjectId: string, id: string): string {
  const base = `${ACC_HOSTS.web}/build/${kind === "RFI" ? "rfis" : "submittals"}/projects/${encodeURIComponent(accProjectId)}`;
  return kind === "RFI" ? `${base}/rfis/${encodeURIComponent(id)}` : `${base}/items/${encodeURIComponent(id)}`;
}

export function normaliseAccRfi(accProjectId: string, raw: Raw): AccFeedItem | null {
  const id = str(raw.id);
  if (!id) return null;
  return {
    kind: "RFI",
    accId: id,
    number: str(raw.identifier) ?? str(raw.customIdentifier) ?? str(raw.number),
    title: str(raw.title) ?? str(raw.subject) ?? `RFI ${str(raw.identifier) ?? id}`,
    status: str(raw.status),
    revision: null,
    discipline: null,
    ballInCourt: assignee(raw),
    dueDate: day(raw.dueDate),
    updatedAt: str(raw.updatedAt),
    webUrl: accWebUrl("RFI", accProjectId, id),
  };
}

export function normaliseAccSubmittal(accProjectId: string, raw: Raw): AccFeedItem | null {
  const id = str(raw.id);
  if (!id) return null;
  const specSection = raw.specSection && typeof raw.specSection === "object" ? (raw.specSection as Raw) : null;
  return {
    kind: "SUBMITTAL",
    accId: id,
    number: str(raw.customIdentifier) ?? str(raw.identifier) ?? str(raw.number),
    title: str(raw.title) ?? `Submittal ${str(raw.customIdentifier) ?? id}`,
    status: str(raw.stateId) ?? str(raw.status),
    revision: str(raw.currentStepName) ?? str(raw.revision),
    discipline: (specSection ? str(specSection.title) ?? str(specSection.number) : null) ?? str(raw.specSection),
    ballInCourt: assignee(raw),
    dueDate: day(raw.dueDate) ?? day(raw.submittedDate),
    updatedAt: str(raw.updatedAt),
    webUrl: accWebUrl("SUBMITTAL", accProjectId, id),
  };
}

type Ref = { accAccountId: string; accProjectId: string };

const LIST = { perPage: 100 };
export const ACC_ITEM_LIMIT = 1000;

export async function fetchAccRfis(config: AccConfig, accessToken: string, ref: Ref, deps: AccRequestDeps = {}): Promise<AccPageResult<AccFeedItem>> {
  const page = await accAllPages<Raw>(
    config,
    accessToken,
    `/construction/rfis/v2/projects/${encodeURIComponent(ref.accProjectId)}/rfis`,
    { ...LIST, limit: ACC_ITEM_LIMIT },
    deps,
  );
  return { ...page, items: page.items.map((raw) => normaliseAccRfi(ref.accProjectId, raw)).filter(isItem) };
}

export async function fetchAccSubmittals(config: AccConfig, accessToken: string, ref: Ref, deps: AccRequestDeps = {}): Promise<AccPageResult<AccFeedItem>> {
  const page = await accAllPages<Raw>(
    config,
    accessToken,
    `/construction/submittals/v2/projects/${encodeURIComponent(ref.accProjectId)}/items`,
    { ...LIST, limit: ACC_ITEM_LIMIT },
    deps,
  );
  return { ...page, items: page.items.map((raw) => normaliseAccSubmittal(ref.accProjectId, raw)).filter(isItem) };
}

function isItem(item: AccFeedItem | null): item is AccFeedItem {
  return item !== null;
}

/* ------------------------------------------------------------------ */
/* What was verified, and what was not                                 */
/* ------------------------------------------------------------------ */

/**
 * Read on 2026-09-19 from Autodesk Platform Services' own docs: the
 * machine-readable `https://aps.autodesk.com/llms-full.txt` dump (which
 * covers Authentication, Data Management, Model Derivative, Account Admin
 * and Construction.Issues, but — as far as this dump goes — not RFIs or
 * Submittals), the APS blog (`aps.autodesk.com/blog/…`), and
 * `help.autodesk.com`. The interactive HTTP reference pages
 * (`aps.autodesk.com/en/docs/**​/reference/http/**`) render in JavaScript —
 * a plain fetch returns only page chrome — the same limitation
 * `packages/integrations/src/procore.ts`'s notes record for
 * developers.procore.com, and a live-browser attempt this session landed on
 * a generic nav shell rather than the specific endpoint page. So this file
 * carries more "not independently verified this session" entries than
 * procore.ts does; that is an honest reflection of what could and could not
 * be confirmed from a sandboxed research pass, not a guess dressed up as a
 * fact.
 *
 * VERIFIED
 *   - Auth is APS (formerly Forge) OAuth 2.0. 3-legged authorization-code
 *     grant with PKCE at
 *     https://developer.api.autodesk.com/authentication/v2/{authorize,token};
 *     a confidential/server app authenticates the token request with HTTP
 *     Basic auth (client_id:client_secret).
 *   - Access tokens last 60 minutes; refresh tokens last 15 days;
 *     authorization codes last 5 minutes. Auth endpoints (authorize, token,
 *     introspect, logout) are rate-limited at 500 calls/minute, revoke at
 *     100/minute.
 *   - APP REGISTRATION IS ONE GLOBAL REGISTRATION, not per-GC: a single
 *     Client ID/Secret is created at https://aps.autodesk.com/myapps by
 *     whoever holds C Stream's own Autodesk developer account (Diego, per
 *     CLAUDE.md's ownership split) — the same "one app, many callers" shape
 *     as Procore's, DocuSign's and QuickBooks' app registrations. Callback
 *     URLs are registered THERE and must match exactly what the app sends
 *     as `redirect_uri`. Unlike QuickBooks' single-redirect-URI scar
 *     (CLAUDE.md), APS supports up to 50 callback URLs on one app — so
 *     adding a preview or a new production domain is registering an
 *     ADDITIONAL callback, never overwriting the one slot a domain change
 *     silently broke QuickBooks by landing in the wrong place.
 *   - PERMISSION MODEL, THE PART THAT MATTERS MOST FOR A SUB. A 3-legged
 *     token only sees what the signed-in ACC user can see — same
 *     no-server-side-override rule as Procore. Separately, and BEFORE that:
 *     the GC's ACC ACCOUNT must add this app as a "Custom Integration"
 *     (Account Admin → Custom Integrations, an ACCOUNT ADMIN's step — needs
 *     only this app's Client ID, never the secret) before ANY of that
 *     account's projects are readable by it at all. This is the exact same
 *     shape as Procore's "the GC's Company Admin has to add the C Stream
 *     app to their company first" (see ProcoreForbiddenError) — a least-
 *     privileged sub's own login is never enough by itself, and it is the
 *     GC's admin who unblocks it, not C Stream's. Once the app is added at
 *     the account level, an ordinary PROJECT MEMBER's login (not an account
 *     admin) reads whatever that member's own project role permits — this
 *     client is written for that case throughout, never assuming
 *     account-admin rights.
 *   - Data Management API: GET /project/v1/hubs (the ACC/BIM 360 accounts
 *     this login belongs to) and GET
 *     /project/v1/hubs/{hub_id}/projects (the projects in one), JSON:API
 *     shaped (`data[]` with `id`/`attributes`). Folders nest up to 25
 *     levels.
 *   - Rate limiting generally: 429 with a `Retry-After` header in seconds.
 *   - ACC Issues API v1 (`/construction/issues/v1/...`) is real, stable and
 *     has a `GET .../users/me` permission-introspection endpoint
 *     (`permittedAttributes`/`permittedStatuses`) — not used by this feed
 *     (Issues is out of scope this phase, see acc.prisma's header), but its
 *     existence and shape informed the defensive `{results, pagination}`
 *     envelope this file assumes for RFIs/Submittals.
 *
 * NOT VERIFIED, and said here so nobody mistakes it for fact
 *   - The exact RFI and Submittals API base paths as of the date this
 *     ships. `/construction/rfis/v2/projects/{projectId}/rfis` and
 *     `/construction/submittals/v2/projects/{projectId}/items` are what
 *     Autodesk's own reference pages for those paths resolve to as of
 *     2026-09-18/19 — but Autodesk's OWN blog says the RFI v2 API has been
 *     superseded by a v3, and that ACC-compatible `/construction/` RFI
 *     endpoints were at one point slated to consolidate into `/bim360/`
 *     ones. The docs portal itself appears to have been restructured under
 *     "Forma APIs" branding during this research. This is exactly the kind
 *     of drift CLAUDE.md's own traps section warns about — RE-VERIFY
 *     against a live ACC sandbox project before this goes live, and expect
 *     to adjust the base path and/or response field names below if it has
 *     moved.
 *   - The response field names `normaliseAccRfi`/`normaliseAccSubmittal` read
 *     (`identifier`, `subject`, `stateId`, `currentStepName`,
 *     `specSection`, `assignedTo`, …) are a best-effort reading of publicly
 *     documented Submittals API change-log posts (customIdentifier,
 *     spec-section, item transitions) and the Issues API's shape, not a
 *     field-by-field confirmation against a live response. Every field is
 *     read defensively with a null fallback rather than throwing, so a
 *     wrong guess degrades to a blank column instead of a crash or (worse)
 *     silently-wrong data with nothing to notice it by.
 *   - The `{results, pagination}` list envelope for RFIs/Submittals
 *     specifically (confirmed only for Issues).
 *   - The "b." hub/project id prefix stripped for the construction APIs —
 *     standard, widely-documented APS behaviour, not confirmed from a
 *     primary Autodesk doc this session.
 *   - The exact ACC web URL patterns in `accWebUrl` — a reasonable reading
 *     of ACC's Autodesk Build URL structure, not confirmed against a live
 *     project.
 *   - Whether APS rotates refresh tokens on every use. Handled safely
 *     either way — see refreshAccTokens's doc comment.
 *   - The precise OAuth scope string(s) the construction APIs check versus
 *     Data Management's `data:read` — `account:read` is added defensively;
 *     if a live sandbox 403s on a scope this client is not requesting, that
 *     is the first place to look.
 */
export const ACC_API_NOTES_VERIFIED_ON = "2026-09-19";
