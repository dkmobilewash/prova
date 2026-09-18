// Procore — OAuth 2.0 and a READ-ONLY REST client, for a feed of a GC's
// project (drawings, RFIs, submittals) into a subcontractor's job.
//
// READ-ONLY IS STRUCTURAL, NOT A PROMISE. The only function in this file
// that talks to Procore's API is `procoreGet`, and its method is the
// literal "GET" — there is no parameter that could make it anything else.
// The only POSTs are to Procore's OAuth token endpoint, which is how every
// OAuth client obtains a token and changes nothing in anybody's project.
// `procore-client.test.ts` records every request the client makes and
// fails on any non-GET to an API host.
//
// Sources: see the notes at the bottom of this file for which
// facts were read from Procore's current docs and which were not.

type Env = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The env var names, in one place, so the "not set up" card and the setup
 * steps name the same things. */
export const PROCORE_ENV = {
  clientId: "PROCORE_CLIENT_ID",
  clientSecret: "PROCORE_CLIENT_SECRET",
  redirectUri: "PROCORE_REDIRECT_URI",
  /** Optional. "sandbox" points every call at Procore's sandbox hosts;
   * anything else (including unset) is production. */
  environment: "PROCORE_ENVIRONMENT",
} as const;

export type ProcoreEnvironment = "production" | "sandbox";

export interface ProcoreHosts {
  /** OAuth authorize + token. */
  login: string;
  /** REST API. */
  api: string;
  /** The web app, for "Open in Procore" links. */
  web: string;
}

/**
 * Procore keeps sandbox and production entirely apart: different login
 * host, different API host, and an app's sandbox credentials only work
 * against the sandbox hosts.
 */
export const PROCORE_HOSTS: Record<ProcoreEnvironment, ProcoreHosts> = {
  production: {
    login: "https://login.procore.com",
    api: "https://api.procore.com",
    web: "https://app.procore.com",
  },
  sandbox: {
    login: "https://login-sandbox.procore.com",
    api: "https://sandbox.procore.com",
    web: "https://sandbox.procore.com",
  },
};

export interface ProcoreConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: ProcoreEnvironment;
  hosts: ProcoreHosts;
}

/** Null when any required variable is missing — never a throw, so a page
 * can ask "is this set up?" without a try/catch. */
export function readProcoreConfig(env: Env = process.env): ProcoreConfig | null {
  const clientId = env[PROCORE_ENV.clientId]?.trim();
  const clientSecret = env[PROCORE_ENV.clientSecret]?.trim();
  const redirectUri = env[PROCORE_ENV.redirectUri]?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  const environment: ProcoreEnvironment =
    env[PROCORE_ENV.environment]?.trim().toLowerCase() === "sandbox" ? "sandbox" : "production";
  return { clientId, clientSecret, redirectUri, environment, hosts: PROCORE_HOSTS[environment] };
}

/**
 * The consent-screen URL. Procore has no OAuth scopes: what a token can read
 * is whatever the signed-in Procore user can read, project by project. PKCE
 * (S256) is sent as well as the client secret — see the notes at the bottom.
 */
export function procoreAuthorizeUrl(config: ProcoreConfig, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${config.hosts.login}/oauth/authorize?${params.toString()}`;
}

export interface ProcoreTokens {
  accessToken: string;
  refreshToken: string;
  /** When the access token stops working, from `expires_in` +
   * `created_at` (or now). Null when Procore did not say. */
  expiresAt: Date | null;
}

/** Thrown by the token endpoint. `invalidGrant` means the refresh token is
 * dead (used, revoked) and only a person reconnecting fixes it. The
 * message never contains a token. */
export class ProcoreAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly invalidGrant: boolean,
  ) {
    super(message);
    this.name = "ProcoreAuthError";
  }
}

async function tokenRequest(
  config: ProcoreConfig,
  fetchImpl: FetchLike,
  body: URLSearchParams,
  now: () => Date,
): Promise<ProcoreTokens> {
  const response = await fetchImpl(`${config.hosts.login}/oauth/token`, {
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
    // The error CODE only — the body of a token response can hold a token,
    // and this message ends up in logs.
    const code = typeof parsed.error === "string" ? parsed.error : "unknown_error";
    throw new ProcoreAuthError(
      `Procore token endpoint returned ${response.status} (${code})`,
      response.status,
      code === "invalid_grant",
    );
  }
  const accessToken = parsed.access_token;
  const refreshToken = parsed.refresh_token;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    throw new ProcoreAuthError("Procore token endpoint answered without an access and refresh token", response.status, false);
  }
  const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : Number(parsed.expires_in);
  const createdAt = typeof parsed.created_at === "number" ? parsed.created_at : null;
  const issued = createdAt ? createdAt * 1000 : now().getTime();
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(issued + expiresIn * 1000) : null;
  return { accessToken, refreshToken, expiresAt };
}

export function exchangeProcoreCode(
  config: ProcoreConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike = fetch,
  now: () => Date = () => new Date(),
): Promise<ProcoreTokens> {
  return tokenRequest(
    config,
    fetchImpl,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    }),
    now,
  );
}

/**
 * Every refresh returns a NEW refresh token and the old one stops working
 * (Procore's refresh tokens are single-use). The caller must store the new
 * pair before anything else — see apps/web/lib/procore/connection.ts.
 */
export function refreshProcoreTokens(
  config: ProcoreConfig,
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
  now: () => Date = () => new Date(),
): Promise<ProcoreTokens> {
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
export class ProcoreUnauthorizedError extends Error {
  constructor() {
    super("Procore refused the access token (401)");
    this.name = "ProcoreUnauthorizedError";
  }
}

/** 403: this login cannot read this. Two causes, and Procore's docs name
 * both: the GC's company has not INSTALLED the C Stream app ("App is not
 * connected to this company" — every company an app reads must install it,
 * a sub's invitation is not enough), or the user's project permissions do
 * not include this tool. Either way the GC fixes it, not a reconnect, and
 * it is no reason to stop reading the other tools. */
export class ProcoreForbiddenError extends Error {
  constructor(what: string) {
    super(
      `Procore wouldn't show ${what} to C Stream. Either the GC hasn't added the C Stream app to their Procore company yet, or your login doesn't have access to that tool on this project — both are fixed on the GC's side.`,
    );
    this.name = "ProcoreForbiddenError";
  }
}

/** Anything else that went wrong, with a message safe to log and to show:
 * it names what failed, never a token or a payload. */
export class ProcoreApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcoreApiError";
  }
}

/** How many times one request is retried after a 429. */
export const PROCORE_MAX_RETRIES = 3;
/** Longest single wait, so a far-off reset cannot park a Server Action. */
export const PROCORE_MAX_WAIT_MS = 15_000;

/**
 * How long to wait after a 429 or 503. Procore's 429 carries NO Retry-After;
 * it sends `X-Rate-Limit-Reset`, epoch SECONDS for when the window (hourly,
 * or the 10-second spike window) resets. Its 503 does carry Retry-After.
 * Both are honoured; capped, and never below half a second, plus jitter so
 * two tabs do not retry in lockstep.
 */
export function rateLimitWaitMs(headers: Headers, now: Date): number {
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(PROCORE_MAX_WAIT_MS, retryAfter * 1000);
  const reset = Number(headers.get("x-rate-limit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const ms = reset * 1000 - now.getTime();
    return Math.min(PROCORE_MAX_WAIT_MS, Math.max(500, ms) + Math.floor(Math.random() * 250));
  }
  return 5_000;
}

export type ProcoreRequestDeps = {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Query = Record<string, string | number | undefined>;

/**
 * THE one call to Procore's API. GET, always — the method is a literal.
 *
 * `procoreCompanyId` is REQUIRED by the type and sent as the
 * `Procore-Company-Id` header on every request: Procore routes each call to
 * the company's data zone by it. The one call that has no company yet —
 * listing the companies — passes null, and says so at its call site.
 */
export async function procoreGet(
  config: ProcoreConfig,
  accessToken: string,
  path: string,
  procoreCompanyId: string | null,
  query: Query = {},
  deps: ProcoreRequestDeps = {},
): Promise<{ body: unknown; headers: Headers }> {
  if (!path.startsWith("/rest/")) throw new ProcoreApiError(`Refusing a Procore path outside /rest/: ${path}`);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  const url = `${config.hosts.api}${path}${qs ? `?${qs}` : ""}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  if (procoreCompanyId !== null) headers["Procore-Company-Id"] = procoreCompanyId;

  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, { method: "GET", headers });

    if (response.status === 401) throw new ProcoreUnauthorizedError();
    if (response.status === 403) throw new ProcoreForbiddenError(describePath(path));
    // 503 is Procore's heavy-load answer and, unlike 429, carries
    // Retry-After. Same retry budget.
    if (response.status === 429 || response.status === 503) {
      if (attempt >= PROCORE_MAX_RETRIES) {
        throw new ProcoreApiError(
          response.status === 429
            ? "Procore is limiting how fast C Stream can read right now. Wait a few minutes and press Refresh."
            : "Procore is busy right now. Wait a few minutes and press Refresh.",
        );
      }
      await sleep(rateLimitWaitMs(response.headers, now()));
      continue;
    }
    if (response.status === 404) throw new ProcoreApiError(`Procore couldn't find ${describePath(path)} — it may have been removed, or you were taken off the project.`);
    if (!response.ok) throw new ProcoreApiError(`Procore answered ${response.status} for ${describePath(path)}.`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProcoreApiError(`Procore's answer for ${describePath(path)} wasn't readable.`);
    }
    return { body, headers: response.headers };
  }
}

function describePath(path: string): string {
  if (path.includes("rfis")) return "RFIs";
  if (path.includes("submittals")) return "submittals";
  if (path.includes("drawing")) return "drawings";
  if (path.includes("projects")) return "the project list";
  if (path.includes("companies")) return "the company list";
  return "that";
}

export type ProcorePageResult<T> = { items: T[]; truncated: boolean; total: number | null };

/**
 * Every page of one list, by `page`/`per_page`, stopping at the last page or
 * at `limit` items — whichever comes first. `truncated` says which, so the
 * page can say "Procore has more than N" rather than silently show part.
 *
 * The last page is detected three independent ways, and any one stops the
 * walk: fewer than `per_page` rows back, the `Total` header reached, or an
 * empty page. A server that ignored `page` and kept answering page 1 would
 * otherwise loop forever, so a hard page ceiling stops it with an error.
 */
export async function procoreAllPages<T>(
  config: ProcoreConfig,
  accessToken: string,
  path: string,
  procoreCompanyId: string | null,
  options: { perPage: number; limit: number; query?: Query },
  deps: ProcoreRequestDeps = {},
): Promise<ProcorePageResult<T>> {
  const items: T[] = [];
  let total: number | null = null;
  const maxPages = Math.ceil(options.limit / options.perPage) + 1;
  for (let page = 1; page <= maxPages; page++) {
    const { body, headers } = await procoreGet(
      config,
      accessToken,
      path,
      procoreCompanyId,
      { ...options.query, page, per_page: options.perPage },
      deps,
    );
    if (!Array.isArray(body)) throw new ProcoreApiError(`Procore's answer for ${describePath(path)} was not a list.`);
    const headerTotal = Number(headers.get("total"));
    if (Number.isFinite(headerTotal) && headers.get("total") !== null) total = headerTotal;
    for (const item of body as T[]) {
      if (items.length >= options.limit) return { items, truncated: true, total };
      items.push(item);
    }
    const done =
      body.length === 0 || body.length < options.perPage || (total !== null && page * options.perPage >= total);
    if (done) return { items, truncated: false, total };
    if (items.length >= options.limit) return { items, truncated: true, total };
  }
  throw new ProcoreApiError(`Procore's ${describePath(path)} list did not end where it said it would.`);
}

/* ------------------------------------------------------------------ */
/* What is read                                                        */
/* ------------------------------------------------------------------ */

export type ProcoreCompany = { id: string; name: string };
export type ProcoreProject = { id: string; name: string; number: string | null; companyId: string; companyName: string };

type Raw = Record<string, unknown>;

function str(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function idOf(raw: Raw): string | null {
  return str(raw.id);
}

const LIST = { perPage: 100 };

/** The companies this Procore login belongs to — for a sub, typically
 * their own company plus each GC that invited them. No company header:
 * this is the call that finds out which companies exist. */
export async function listProcoreCompanies(
  config: ProcoreConfig,
  accessToken: string,
  deps: ProcoreRequestDeps = {},
): Promise<ProcoreCompany[]> {
  const { items } = await procoreAllPages<Raw>(config, accessToken, "/rest/v1.0/companies", null, { ...LIST, limit: 200 }, deps);
  return items
    .filter((raw) => raw.is_active !== false)
    .map((raw) => ({ id: idOf(raw), name: str(raw.name) }))
    .filter((c): c is ProcoreCompany => Boolean(c.id))
    .map((c) => ({ id: c.id, name: c.name ?? `Procore company ${c.id}` }));
}

/** Who this token belongs to, for the card's "Account" line. One of the
 * two calls Procore exempts from the company header. */
export async function fetchProcoreMe(
  config: ProcoreConfig,
  accessToken: string,
  deps: ProcoreRequestDeps = {},
): Promise<{ id: string; name: string }> {
  const { body } = await procoreGet(config, accessToken, "/rest/v1.0/me", null, {}, deps);
  const raw = (body && typeof body === "object" ? body : {}) as Raw;
  const id = idOf(raw);
  if (!id) throw new ProcoreApiError("Procore did not say whose login this is.");
  return { id, name: str(raw.name) ?? str(raw.login) ?? "Procore user" };
}

/** The projects in one Procore company that this login can see. */
export async function listProcoreProjects(
  config: ProcoreConfig,
  accessToken: string,
  company: ProcoreCompany,
  deps: ProcoreRequestDeps = {},
): Promise<ProcoreProject[]> {
  const { items } = await procoreAllPages<Raw>(
    config,
    accessToken,
    "/rest/v1.1/projects",
    company.id,
    { ...LIST, limit: 500, query: { company_id: company.id } },
    deps,
  );
  return items
    .filter((raw) => raw.active !== false)
    .map((raw) => ({ id: idOf(raw), name: str(raw.display_name) ?? str(raw.name), number: str(raw.project_number) }))
    .filter((p): p is { id: string; name: string | null; number: string | null } => Boolean(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name ?? `Procore project ${p.id}`,
      number: p.number,
      companyId: company.id,
      companyName: company.name,
    }));
}

export type ProcoreFeedKind = "DRAWING" | "RFI" | "SUBMITTAL";

/** One GC record, normalised. Dates are calendar days (YYYY-MM-DD) or ISO
 * instants, never parsed further here. */
export type ProcoreFeedItem = {
  kind: ProcoreFeedKind;
  procoreId: string;
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

function names(value: unknown): string | null {
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  const out = list
    .map((entry) => (entry && typeof entry === "object" ? str((entry as Raw).name) ?? str((entry as Raw).login) : null))
    .filter((name): name is string => Boolean(name));
  return out.length > 0 ? out.join(", ") : null;
}

function statusName(value: unknown): string | null {
  if (value && typeof value === "object") return str((value as Raw).name) ?? str((value as Raw).status);
  return str(value);
}

/** Links are BUILT from ids and the configured web host — never copied from
 * a payload — so every "Open in Procore" link points at Procore. */
export function procoreWebUrl(config: ProcoreConfig, kind: ProcoreFeedKind, projectId: string, id: string, areaId?: string | null): string {
  const base = `${config.hosts.web}/${encodeURIComponent(projectId)}/project`;
  if (kind === "RFI") return `${base}/rfi/show/${encodeURIComponent(id)}`;
  if (kind === "SUBMITTAL") return `${base}/submittal_logs/${encodeURIComponent(id)}`;
  return areaId
    ? `${base}/drawing_areas/${encodeURIComponent(areaId)}/drawing_log`
    : `${base}/drawing_log`;
}

export const PROCORE_ITEM_LIMIT = 1000;

/** A payload URL, kept only if it is on this environment's Procore web
 * host over https. Anything else is dropped rather than rendered as a
 * link. */
export function onProcoreWeb(config: ProcoreConfig, value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  try {
    const url = new URL(s);
    const web = new URL(config.hosts.web);
    return url.protocol === "https:" && url.host === web.host ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normaliseRfi(config: ProcoreConfig, projectId: string, raw: Raw): ProcoreFeedItem | null {
  const id = idOf(raw);
  if (!id) return null;
  return {
    kind: "RFI",
    procoreId: id,
    number: str(raw.full_number) ?? str(raw.number),
    title: str(raw.subject) ?? str(raw.title) ?? `RFI ${str(raw.number) ?? id}`,
    status: statusName(raw.status),
    revision: null,
    discipline: null,
    ballInCourt: names(raw.ball_in_court) ?? names(raw.assignee) ?? names(raw.assignees),
    dueDate: day(raw.due_date),
    updatedAt: str(raw.updated_at),
    // The RFI payload carries its own `link`; used only when it points at
    // this environment's Procore web host, otherwise the verified pattern.
    webUrl: onProcoreWeb(config, raw.link) ?? procoreWebUrl(config, "RFI", projectId, id),
  };
}

export function normaliseSubmittal(config: ProcoreConfig, projectId: string, raw: Raw): ProcoreFeedItem | null {
  const id = idOf(raw);
  if (!id) return null;
  return {
    kind: "SUBMITTAL",
    procoreId: id,
    number: str(raw.formatted_number) ?? str(raw.number),
    title: str(raw.title) ?? `Submittal ${str(raw.number) ?? id}`,
    status: statusName(raw.status),
    revision: str(raw.revision),
    discipline: null,
    ballInCourt: names(raw.ball_in_court),
    dueDate: day(raw.due_date),
    updatedAt: str(raw.updated_at),
    webUrl: procoreWebUrl(config, "SUBMITTAL", projectId, id),
  };
}

/** A drawing and its CURRENT revision. Superseded revisions are not read:
 * a sub building from a superseded sheet is the mistake this feed exists to
 * prevent, so only what Procore calls current is shown. */
export function normaliseDrawing(
  config: ProcoreConfig,
  projectId: string,
  areaId: string,
  raw: Raw,
): ProcoreFeedItem | null {
  const id = idOf(raw);
  if (!id) return null;
  // An obsolete drawing has been pulled from the set. Not shown: it is not
  // something anyone should build from.
  if (raw.obsolete === true) return null;
  const current = (raw.current_revision && typeof raw.current_revision === "object" ? raw.current_revision : {}) as Raw;
  const discipline =
    raw.discipline && typeof raw.discipline === "object" ? str((raw.discipline as Raw).name) : str(raw.discipline);
  return {
    kind: "DRAWING",
    procoreId: id,
    number: str(raw.number) ?? str(raw.drawing_number) ?? str(current.number),
    title: str(raw.title) ?? str(current.title) ?? `Drawing ${id}`,
    status: str(current.status) ?? null,
    revision: str(current.revision_number),
    discipline,
    ballInCourt: null,
    dueDate: null,
    updatedAt: str(current.updated_at) ?? str(raw.updated_at),
    webUrl: procoreWebUrl(config, "DRAWING", projectId, id, areaId),
  };
}

type Ref = { procoreCompanyId: string; procoreProjectId: string };

export async function fetchProcoreRfis(
  config: ProcoreConfig,
  accessToken: string,
  ref: Ref,
  deps: ProcoreRequestDeps = {},
): Promise<ProcorePageResult<ProcoreFeedItem>> {
  const page = await procoreAllPages<Raw>(
    config,
    accessToken,
    `/rest/v1.0/projects/${encodeURIComponent(ref.procoreProjectId)}/rfis`,
    ref.procoreCompanyId,
    { ...LIST, limit: PROCORE_ITEM_LIMIT },
    deps,
  );
  return { ...page, items: page.items.map((raw) => normaliseRfi(config, ref.procoreProjectId, raw)).filter(isItem) };
}

export async function fetchProcoreSubmittals(
  config: ProcoreConfig,
  accessToken: string,
  ref: Ref,
  deps: ProcoreRequestDeps = {},
): Promise<ProcorePageResult<ProcoreFeedItem>> {
  const page = await procoreAllPages<Raw>(
    config,
    accessToken,
    `/rest/v1.1/projects/${encodeURIComponent(ref.procoreProjectId)}/submittals`,
    ref.procoreCompanyId,
    { ...LIST, limit: PROCORE_ITEM_LIMIT },
    deps,
  );
  return {
    ...page,
    items: page.items.map((raw) => normaliseSubmittal(config, ref.procoreProjectId, raw)).filter(isItem),
  };
}

/** Drawings live under drawing AREAS, so this is two levels: the project's
 * areas, then each area's drawings (with their current revision). */
export async function fetchProcoreDrawings(
  config: ProcoreConfig,
  accessToken: string,
  ref: Ref,
  deps: ProcoreRequestDeps = {},
): Promise<ProcorePageResult<ProcoreFeedItem>> {
  const areas = await procoreAllPages<Raw>(
    config,
    accessToken,
    `/rest/v1.1/projects/${encodeURIComponent(ref.procoreProjectId)}/drawing_areas`,
    ref.procoreCompanyId,
    { ...LIST, limit: 200 },
    deps,
  );
  const items: ProcoreFeedItem[] = [];
  let truncated = areas.truncated;
  for (const area of areas.items) {
    const areaId = idOf(area);
    if (!areaId) continue;
    const remaining = PROCORE_ITEM_LIMIT - items.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const drawings = await procoreAllPages<Raw>(
      config,
      accessToken,
      `/rest/v1.1/drawing_areas/${encodeURIComponent(areaId)}/drawings`,
      ref.procoreCompanyId,
      { ...LIST, limit: remaining, query: { project_id: ref.procoreProjectId } },
      deps,
    );
    if (drawings.truncated) truncated = true;
    for (const raw of drawings.items) {
      const item = normaliseDrawing(config, ref.procoreProjectId, areaId, raw);
      if (item) items.push(item);
    }
  }
  return { items, truncated, total: null };
}

function isItem(item: ProcoreFeedItem | null): item is ProcoreFeedItem {
  return item !== null;
}

/* ------------------------------------------------------------------ */
/* What was verified, and what was not                                 */
/* ------------------------------------------------------------------ */

/**
 * Read on 2026-09-18 from Procore's docs SOURCE — the public
 * `procore/documentation` repo (commit fd31bc4, 2026-09-07; each file is a
 * page at developers.procore.com/documentation/<permalink>) and the OpenAPI
 * JSON behind the reference pages. developers.procore.com itself renders
 * in JavaScript, so a plain fetch of a page returns only navigation.
 *
 * VERIFIED
 *   - authorize/token at login.procore.com/oauth/{authorize,token}; sandbox
 *     at login-sandbox.procore.com with its own credentials; token fields
 *     grant_type, client_id, client_secret, code, redirect_uri (form).
 *   - access token expires_in 5400 (90 min), with created_at; refresh
 *     tokens are single-use ("invalidated as soon as it's used") and do not
 *     otherwise expire; refresh sends redirect_uri too.
 *   - no OAuth scopes: a user-level token sees what that user can see.
 *   - API at api.procore.com, Developer Sandbox API at sandbox.procore.com.
 *   - Procore-Company-Id required on every call except GET /rest/v1.0/me
 *     and GET /rest/v1.0/companies.
 *   - GET /rest/v1.0/companies; GET /rest/v1.1/projects?company_id=;
 *     GET /rest/v1.1/projects/{id}/drawing_areas;
 *     GET /rest/v1.1/drawing_areas/{id}/drawings (number, title,
 *     discipline, obsolete, current_revision{revision_number, updated_at});
 *     GET /rest/v1.0/projects/{id}/rfis (number, full_number, subject,
 *     status, due_date, updated_at, ball_in_court, link);
 *     GET /rest/v1.1/projects/{id}/submittals (formatted_number, title,
 *     revision, status{name}, due_date, ball_in_court[], updated_at).
 *   - page/per_page pagination with Total, Per-Page and Link headers.
 *   - 429 on the hourly or 10-second spike limit, with X-Rate-Limit-Reset
 *     (epoch seconds) and NO Retry-After; 503 under load WITH Retry-After.
 *   - every company an app reads must have INSTALLED the app (Company
 *     Admin, App Management); until then company/project calls answer 4xx,
 *     including 403 "App is not connected to this company".
 *   - webhooks carry no signature; authentication is a header you choose
 *     when creating the hook (not used here — no webhooks in this feed).
 *
 * NOT VERIFIED, and said here so nobody mistakes it for fact
 *   - PKCE. The docs never mention it. It is sent anyway: an OAuth server
 *     that does not support it ignores the extra parameters, and one that
 *     does is satisfied by the verifier this client sends. The CSRF check
 *     is `state`, which IS documented, and the code exchange needs the
 *     client secret regardless.
 *   - web URLs for a submittal (/{project}/project/submittal_logs/{id}) and
 *     for a drawing area's log. Only the RFI pattern appears in the docs,
 *     as example values; the RFI's own `link` field is preferred.
 *   - that a subcontractor's login sees a GC's project once the GC has
 *     installed the app. Implied by the install rule and user-level
 *     permissions; never stated for this case.
 */
export const PROCORE_API_NOTES_VERIFIED_ON = "2026-09-18";
