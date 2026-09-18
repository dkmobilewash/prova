// Jobber — OAuth 2.0 and a READ-ONLY GraphQL client, for a one-way import.
//
// Every endpoint, header and limit below was read off Jobber's developer
// docs on 2026-09-18 (developer.getjobber.com, reached through a browser —
// the site answers WebFetch/curl with a Cloudflare challenge). Pages:
//
//   /docs/building_your_app/app_authorization/   authorize, token, PKCE, JWT exp
//   /docs/building_your_app/refresh_token_rotation/
//   /docs/using_jobbers_api/api_queries_and_mutations/   endpoint, 200-on-error
//   /docs/using_jobbers_api/api_versioning/ and /docs/changelog/
//   /docs/using_jobbers_api/api_rate_limits/     cost, THROTTLED, 2500/5min -> 429
//
// NOT verified against current docs, and said here so nobody mistakes it
// for fact: the exact FIELD names in the queries at the bottom. Jobber's
// field reference lives behind a Developer Center login (GraphiQL); these
// match the official Jobber-AppTemplate-RailsAPI schema dump and the few
// fields the public docs quote. The queries ask for as little as possible
// so a renamed field breaks one thing loudly — a GraphQL error naming the
// field — rather than several things quietly.
//
// Nothing here writes to Jobber. There is no mutation in this file.

export const JOBBER_AUTHORIZE_URL = "https://api.getjobber.com/api/oauth/authorize";
export const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
export const JOBBER_GRAPHQL_URL = "https://api.getjobber.com/api/graphql";

/**
 * Required on every GraphQL request. Dated versions are supported for at
 * least 12 months and reachable for up to 18; a removed one is silently
 * upgraded to the oldest supported version (which is how a stale value here
 * would fail — quietly). `2026-05-12` was the newest on 2026-09-18. Every
 * response carries `extensions.versioning` with a warning when the version
 * nears end of support; `jobberGraphql` logs that warning.
 */
export const JOBBER_GRAPHQL_VERSION = "2026-05-12";

/** The env var names, in one place, so the "not set up yet" card and the
 * setup steps name the same four things. */
export const JOBBER_ENV = {
  clientId: "JOBBER_CLIENT_ID",
  clientSecret: "JOBBER_CLIENT_SECRET",
  redirectUri: "JOBBER_REDIRECT_URI",
} as const;

export interface JobberConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type Env = Record<string, string | undefined>;

/** Null when any of the three is missing — never a throw, so a page can ask
 * "is this set up?" without a try/catch. */
export function readJobberConfig(env: Env = process.env): JobberConfig | null {
  const clientId = env[JOBBER_ENV.clientId]?.trim();
  const clientSecret = env[JOBBER_ENV.clientSecret]?.trim();
  const redirectUri = env[JOBBER_ENV.redirectUri]?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

/**
 * The consent-screen URL. Scopes are NOT a parameter: Jobber takes them from
 * the app's settings in the Developer Center. PKCE is S256 only.
 */
export function jobberAuthorizeUrl(config: JobberConfig, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${JOBBER_AUTHORIZE_URL}?${params.toString()}`;
}

export interface JobberTokens {
  accessToken: string;
  refreshToken: string;
}

/** Thrown by the token endpoint. `invalidGrant` is the one worth branching
 * on: the refresh token is dead (rotated, revoked, account disconnected) and
 * only a person reconnecting fixes it. The message never contains a token. */
export class JobberAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly invalidGrant: boolean,
  ) {
    super(message);
    this.name = "JobberAuthError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function tokenRequest(fetchImpl: FetchLike, body: URLSearchParams): Promise<JobberTokens> {
  const response = await fetchImpl(JOBBER_TOKEN_URL, {
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
    // The error CODE only. The body of a token response can hold a token
    // and this message ends up in logs.
    const code = typeof parsed.error === "string" ? parsed.error : "unknown_error";
    throw new JobberAuthError(`Jobber token endpoint returned ${response.status} (${code})`, response.status, code === "invalid_grant");
  }
  const accessToken = parsed.access_token;
  const refreshToken = parsed.refresh_token;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
    throw new JobberAuthError("Jobber token endpoint answered without an access and refresh token", response.status, false);
  }
  return { accessToken, refreshToken };
}

export function exchangeJobberCode(
  config: JobberConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike = fetch,
): Promise<JobberTokens> {
  return tokenRequest(
    fetchImpl,
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    }),
  );
}

/**
 * With Refresh Token Rotation on (Jobber's default, and required for a
 * Marketplace app) every refresh returns a NEW refresh token and the old one
 * dies immediately. The caller must store the pair before making any other
 * call — see lib/jobber/connection.ts.
 */
export function refreshJobberTokens(
  config: JobberConfig,
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<JobberTokens> {
  return tokenRequest(
    fetchImpl,
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
}

/**
 * When the access token stops working, from the JWT's own `exp` (Jobber's
 * access tokens are JWTs that live 60 minutes). The signature is NOT
 * checked — this only decides whether to refresh first, and Jobber checks
 * the token on every call regardless. Null when it cannot be read, which the
 * caller treats as "refresh".
 */
export function jobberTokenExpiresAt(accessToken: string): Date | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof json.exp === "number" ? new Date(json.exp * 1000) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* GraphQL                                                             */
/* ------------------------------------------------------------------ */

/** Jobber answers 401 for an expired or invalid token — the one error that
 * is not a 200. The caller refreshes and tries once more. */
export class JobberUnauthorizedError extends Error {
  constructor() {
    super("Jobber refused the access token (401)");
    this.name = "JobberUnauthorizedError";
  }
}

/** Anything else that went wrong talking to Jobber, with a message safe to
 * log and safe to show: it names what failed, never a token or a payload. */
export class JobberApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobberApiError";
  }
}

type ThrottleStatus = { maximumAvailable?: number; currentlyAvailable?: number; restoreRate?: number };
type Cost = { requestedQueryCost?: number; actualQueryCost?: number; throttleStatus?: ThrottleStatus };

type GraphqlBody<T> = {
  data?: T;
  errors?: { message?: string; extensions?: { code?: string } }[];
  extensions?: { cost?: Cost; versioning?: { version?: string; warning?: string } };
};

/** How many times one query is retried after being throttled. */
export const JOBBER_MAX_RETRIES = 4;
/** Longest single wait, so a bad `restoreRate` cannot park a request for
 * minutes inside a Server Action. */
const MAX_WAIT_MS = 15_000;

/**
 * How long to wait after a THROTTLED answer: long enough for the bucket to
 * refill to what this query asked for, at the rate Jobber says it restores
 * (500 points a second when it was read). Falls back to two seconds when the
 * numbers are missing.
 */
export function throttleWaitMs(cost: Cost | undefined): number {
  const requested = cost?.requestedQueryCost;
  const available = cost?.throttleStatus?.currentlyAvailable;
  const rate = cost?.throttleStatus?.restoreRate;
  if (typeof requested !== "number" || typeof available !== "number" || typeof rate !== "number" || rate <= 0) {
    return 2_000;
  }
  const deficit = Math.max(0, requested - available);
  return Math.min(MAX_WAIT_MS, Math.ceil((deficit / rate) * 1000) + 250);
}

export type JobberRequestDeps = {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One GraphQL query, with the two kinds of rate limit handled:
 *
 *   - query-cost throttling: HTTP 200 with an error whose code is
 *     THROTTLED, and the bucket's state in `extensions.cost`;
 *   - the request-count limit (2500 per 5 minutes): HTTP 429.
 *
 * Both wait and retry, up to JOBBER_MAX_RETRIES times, then give up with a
 * sentence. A 401 is thrown as JobberUnauthorizedError for the caller to
 * refresh on. Any other GraphQL error is thrown, naming the first message —
 * which is how a renamed field would announce itself.
 */
export async function jobberGraphql<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
  deps: JobberRequestDeps = {},
): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(JOBBER_GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-JOBBER-GRAPHQL-VERSION": JOBBER_GRAPHQL_VERSION,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 401) throw new JobberUnauthorizedError();

    if (response.status === 429) {
      if (attempt >= JOBBER_MAX_RETRIES) {
        throw new JobberApiError("Jobber is limiting how fast C Stream can read right now. Wait a few minutes and try again.");
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(MAX_WAIT_MS, retryAfter * 1000) : 5_000);
      continue;
    }

    if (!response.ok) {
      throw new JobberApiError(`Jobber answered ${response.status}.`);
    }

    const body = (await response.json()) as GraphqlBody<T>;
    const warning = body.extensions?.versioning?.warning;
    if (warning) console.warn("Jobber API version warning", { version: JOBBER_GRAPHQL_VERSION, warning });

    const errors = body.errors ?? [];
    if (errors.some((error) => error.extensions?.code === "THROTTLED")) {
      if (attempt >= JOBBER_MAX_RETRIES) {
        throw new JobberApiError("Jobber is limiting how much C Stream can read at once. Wait a minute and try again.");
      }
      await sleep(throttleWaitMs(body.extensions?.cost));
      continue;
    }
    if (errors.length > 0) {
      throw new JobberApiError(`Jobber refused the request: ${errors[0]?.message ?? "unknown error"}`);
    }
    if (body.data === undefined || body.data === null) {
      throw new JobberApiError("Jobber answered with no data.");
    }
    return body.data;
  }
}

type Connection<N> = {
  nodes: N[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  totalCount?: number;
};

export type PageResult<N> = { nodes: N[]; truncated: boolean; totalCount: number | null };

/**
 * Every page of one connection, in order, stopping at the last page or at
 * `limit` nodes — whichever comes first. `truncated` says which, so the
 * preview can say "Jobber has more than N" instead of silently reading part
 * of an account.
 *
 * A page that says there is another page but hands back no cursor, or the
 * same cursor twice, stops the walk with an error rather than looping.
 */
export async function jobberAllPages<N>(
  accessToken: string,
  query: string,
  root: string,
  options: { pageSize: number; limit: number },
  deps: JobberRequestDeps = {},
): Promise<PageResult<N>> {
  const nodes: N[] = [];
  let after: string | null = null;
  const seen = new Set<string>();
  let totalCount: number | null = null;

  for (;;) {
    const data: Record<string, Connection<N>> = await jobberGraphql<Record<string, Connection<N>>>(
      accessToken,
      query,
      { first: options.pageSize, after },
      deps,
    );
    const page = data[root];
    if (!page || !Array.isArray(page.nodes)) {
      throw new JobberApiError(`Jobber's answer had no ${root} list.`);
    }
    if (typeof page.totalCount === "number") totalCount = page.totalCount;
    for (const node of page.nodes) {
      if (nodes.length >= options.limit) return { nodes, truncated: true, totalCount };
      nodes.push(node);
    }
    if (!page.pageInfo?.hasNextPage) return { nodes, truncated: false, totalCount };
    if (nodes.length >= options.limit) return { nodes, truncated: true, totalCount };
    const cursor = page.pageInfo.endCursor;
    if (!cursor || seen.has(cursor)) {
      throw new JobberApiError(`Jobber's ${root} list did not move to its next page.`);
    }
    seen.add(cursor);
    after = cursor;
  }
}

/* ------------------------------------------------------------------ */
/* What is read                                                        */
/* ------------------------------------------------------------------ */

export type JobberAddress = {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
};

export type JobberClient = {
  id: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  isCompany?: boolean | null;
  emails?: { address?: string | null; primary?: boolean | null }[] | null;
  phones?: { number?: string | null; primary?: boolean | null }[] | null;
  billingAddress?: JobberAddress | null;
};

export type JobberProperty = { id: string; address?: JobberAddress | null };

export type JobberJob = {
  id: string;
  jobNumber?: number | null;
  title?: string | null;
  jobStatus?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  instructions?: string | null;
  client?: { id: string } | null;
  property?: JobberProperty | null;
};

export type JobberQuote = {
  id: string;
  quoteNumber?: string | number | null;
  title?: string | null;
  quoteStatus?: string | null;
  client?: { id: string } | null;
  property?: JobberProperty | null;
};

const ADDRESS = "street1 street2 city province postalCode";

export const JOBBER_CLIENTS_QUERY = `query ImportClients($first: Int!, $after: String) {
  clients(first: $first, after: $after) {
    nodes {
      id name firstName lastName companyName isCompany
      emails { address primary }
      phones { number primary }
      billingAddress { ${ADDRESS} }
    }
    pageInfo { hasNextPage endCursor }
    totalCount
  }
}`;

export const JOBBER_JOBS_QUERY = `query ImportJobs($first: Int!, $after: String) {
  jobs(first: $first, after: $after) {
    nodes {
      id jobNumber title jobStatus startAt endAt instructions
      client { id }
      property { id address { ${ADDRESS} } }
    }
    pageInfo { hasNextPage endCursor }
    totalCount
  }
}`;

export const JOBBER_QUOTES_QUERY = `query ImportQuotes($first: Int!, $after: String) {
  quotes(first: $first, after: $after) {
    nodes {
      id quoteNumber title quoteStatus
      client { id }
      property { id address { ${ADDRESS} } }
    }
    pageInfo { hasNextPage endCursor }
    totalCount
  }
}`;

export const JOBBER_ACCOUNT_QUERY = `query ImportAccount { account { id name } }`;

/** Which account the token belongs to, for the card's "Account" line. */
export async function fetchJobberAccount(
  accessToken: string,
  deps: JobberRequestDeps = {},
): Promise<{ id: string; name: string }> {
  const data = await jobberGraphql<{ account?: { id?: string; name?: string } | null }>(
    accessToken,
    JOBBER_ACCOUNT_QUERY,
    {},
    deps,
  );
  if (!data.account?.id) throw new JobberApiError("Jobber did not say which account this is.");
  return { id: data.account.id, name: data.account.name?.trim() || "Jobber account" };
}
