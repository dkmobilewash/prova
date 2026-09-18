import { prisma } from "@prova/db";
import {
  JOBBER_CLIENTS_QUERY,
  JOBBER_JOBS_QUERY,
  JOBBER_QUOTES_QUERY,
  JobberApiError,
  JobberAuthError,
  JobberUnauthorizedError,
  jobberAllPages,
  jobberTokenExpiresAt,
  readJobberConfig,
  refreshJobberTokens,
  type JobberClient,
  type JobberJob,
  type JobberProperty,
  type JobberQuote,
  type JobberRequestDeps,
} from "@prova/integrations";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { JOBBER_PULL_LIMIT, type JobberPull } from "@/lib/jobber-import";

/**
 * The server side of talking to Jobber for one company: the stored
 * credential, its refresh, and the pull.
 *
 * TOKENS. Stored only as AES-256-GCM envelopes (lib/crypto.ts) in
 * IntegrationConnection.encryptedAccessToken/RefreshToken — never a
 * plaintext column, and never in a log line, an error message or anything
 * returned to a page. Decrypted here, at the moment of a call, and nowhere
 * else.
 *
 * REFRESH, AND WHY IT IS A COMPARE-AND-SWAP. Jobber rotates refresh tokens:
 * each refresh returns a new one and the old one dies at once. Two requests
 * refreshing together (a preview and a confirm a second apart, two tabs)
 * would each spend the same refresh token; the loser's is already dead, and
 * if the loser's write landed last it would store a dead token and break the
 * connection for good. So the new pair is written only WHERE the stored
 * refresh token is still the one this request started from. If that matches
 * nothing, someone else refreshed first — read their access token and use
 * it. Jobber's docs suggest exactly this check.
 */

export class JobberNotConnectedError extends Error {
  constructor() {
    super("Jobber isn't connected. Press Connect on the Jobber card first.");
    this.name = "JobberNotConnectedError";
  }
}

export class JobberReconnectError extends Error {
  constructor() {
    super("Jobber stopped accepting C Stream's access — this happens when the app is disconnected on Jobber's side. Press Reconnect on the Jobber card.");
    this.name = "JobberReconnectError";
  }
}

export class JobberNotConfiguredError extends Error {
  constructor() {
    super("Jobber isn't set up on this install yet.");
    this.name = "JobberNotConfiguredError";
  }
}

/** Refresh when the token has less than this left. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

type Deps = JobberRequestDeps & { now?: () => Date };

async function loadConnection(companyId: string) {
  return prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "JOBBER" } },
    select: { id: true, status: true, encryptedAccessToken: true, encryptedRefreshToken: true },
  });
}

async function markNeedsReauth(companyId: string, connectionId: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.integrationConnection.updateMany({
      where: { id: connectionId, companyId },
      data: { status: "NEEDS_REAUTH", lastSyncedAt: now, lastSyncStatus: "FAILURE" },
    });
    await tx.integrationSyncLog.create({
      data: {
        connectionId,
        direction: "PULL",
        status: "FAILURE",
        message: "Jobber refused the stored credential. Reconnect to import again.",
        occurredAt: now,
      },
    });
  });
}

/**
 * A usable access token for this company's Jobber connection. `force`
 * refreshes even if the token looks alive — used once after a 401.
 */
export async function jobberAccessToken(
  companyId: string,
  options: { force?: boolean } = {},
  deps: Deps = {},
): Promise<string> {
  const config = readJobberConfig();
  if (!config) throw new JobberNotConfiguredError();
  const connection = await loadConnection(companyId);
  if (!connection || !connection.encryptedAccessToken || !connection.encryptedRefreshToken) {
    throw new JobberNotConnectedError();
  }
  if (connection.status === "NEEDS_REAUTH") throw new JobberReconnectError();
  if (connection.status !== "CONNECTED") throw new JobberNotConnectedError();

  const accessToken = decryptSecret(connection.encryptedAccessToken);
  const now = (deps.now ?? (() => new Date()))();
  const expiresAt = jobberTokenExpiresAt(accessToken);
  if (!options.force && expiresAt && expiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS) {
    return accessToken;
  }

  let fresh;
  try {
    fresh = await refreshJobberTokens(config, decryptSecret(connection.encryptedRefreshToken), deps.fetchImpl);
  } catch (error) {
    if (error instanceof JobberAuthError && error.invalidGrant) {
      // Maybe another request rotated it a moment ago — if the stored token
      // moved, that request won and its token is good.
      const now2 = await loadConnection(companyId);
      if (now2?.encryptedRefreshToken && now2.encryptedRefreshToken !== connection.encryptedRefreshToken && now2.encryptedAccessToken) {
        return decryptSecret(now2.encryptedAccessToken);
      }
      await markNeedsReauth(companyId, connection.id);
      throw new JobberReconnectError();
    }
    throw error;
  }

  const swapped = await prisma.integrationConnection.updateMany({
    where: { id: connection.id, companyId, encryptedRefreshToken: connection.encryptedRefreshToken },
    data: {
      encryptedAccessToken: encryptSecret(fresh.accessToken),
      encryptedRefreshToken: encryptSecret(fresh.refreshToken),
    },
  });
  if (swapped.count === 1) return fresh.accessToken;

  // Lost the race: another request stored its own pair first. Ours is the
  // one that must NOT be written; theirs is live.
  const winner = await loadConnection(companyId);
  if (winner?.encryptedAccessToken) return decryptSecret(winner.encryptedAccessToken);
  throw new JobberNotConnectedError();
}

/** Runs `fn` with a live token, refreshing and retrying ONCE on a 401. */
export async function withJobberToken<T>(
  companyId: string,
  fn: (accessToken: string) => Promise<T>,
  deps: Deps = {},
): Promise<T> {
  const token = await jobberAccessToken(companyId, {}, deps);
  try {
    return await fn(token);
  } catch (error) {
    if (!(error instanceof JobberUnauthorizedError)) throw error;
    const fresh = await jobberAccessToken(companyId, { force: true }, deps);
    try {
      return await fn(fresh);
    } catch (again) {
      if (again instanceof JobberUnauthorizedError) {
        const connection = await loadConnection(companyId);
        if (connection) await markNeedsReauth(companyId, connection.id);
        throw new JobberReconnectError();
      }
      throw again;
    }
  }
}

export const JOBBER_PROPERTIES_QUERY = `query ImportProperties($first: Int!, $after: String) {
  properties(first: $first, after: $after) {
    nodes { id address { street1 street2 city province postalCode } client { id } }
    pageInfo { hasNextPage endCursor }
    totalCount
  }
}`;

const PAGE = { pageSize: 100, limit: JOBBER_PULL_LIMIT };

/**
 * Everything the import reads, for one company. Read-only: four queries, no
 * mutation. Runs on the server, inside the action — the pulled rows never
 * go to the browser and back, so a big account cannot hit the 1 MB Server
 * Action body limit.
 *
 * The property list is the one query allowed to fail softly: its field
 * names are the least certain (see packages/integrations/src/jobber.ts),
 * and every address that matters also arrives on the job or quote at it.
 */
export async function pullFromJobber(companyId: string, deps: Deps = {}): Promise<JobberPull> {
  return withJobberToken(
    companyId,
    async (token) => {
      const clients = await jobberAllPages<JobberClient>(token, JOBBER_CLIENTS_QUERY, "clients", PAGE, deps);
      const jobs = await jobberAllPages<JobberJob>(token, JOBBER_JOBS_QUERY, "jobs", PAGE, deps);
      const quotes = await jobberAllPages<JobberQuote>(token, JOBBER_QUOTES_QUERY, "quotes", PAGE, deps);
      let properties: JobberPull["properties"] = null;
      let propertiesTruncated = false;
      try {
        const result = await jobberAllPages<JobberProperty & { client?: { id: string } | null }>(
          token,
          JOBBER_PROPERTIES_QUERY,
          "properties",
          PAGE,
          deps,
        );
        properties = result.nodes;
        propertiesTruncated = result.truncated;
      } catch (error) {
        if (!(error instanceof JobberApiError)) throw error;
        console.warn("Jobber property list unreadable; continuing without it", { message: error.message });
      }
      return {
        clients: clients.nodes,
        jobs: jobs.nodes,
        quotes: quotes.nodes,
        properties,
        truncated: {
          clients: clients.truncated,
          jobs: jobs.truncated,
          quotes: quotes.truncated,
          properties: propertiesTruncated,
        },
      };
    },
    deps,
  );
}
