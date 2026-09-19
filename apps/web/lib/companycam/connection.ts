import { prisma } from "@prova/db";
import {
  CompanyCamAuthError,
  CompanyCamUnauthorizedError,
  readCompanyCamConfig,
  refreshCompanyCamTokens,
  type CompanyCamConfig,
  type CompanyCamRequestDeps,
  type CompanyCamTokens,
} from "@prova/integrations";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * The server side of talking to CompanyCam for one company: the stored
 * credential and its refresh. Same design as lib/procore/connection.ts,
 * and for the same reasons.
 *
 * TOKENS. Stored only as AES-256-GCM envelopes (lib/crypto.ts) in
 * IntegrationConnection.encryptedAccessToken/RefreshToken, never in a log
 * line, an error message or anything returned to a page. The access
 * envelope holds the token AND its expiry in one string, so no schema
 * column exists for the two to disagree in.
 *
 * REFRESH IS A COMPARE-AND-SWAP. CompanyCam's docs say each refresh
 * returns a new refresh_token; treated as single-use, exactly like
 * Procore's. Two requests refreshing together both spend the same token;
 * the loser's answer is `invalid_grant`, and if the loser's WRITE landed
 * last it would store a dead token and break the connection for good. So
 * the new pair is written only WHERE the stored refresh envelope is still
 * the one this request started from; if nothing matched, somebody else
 * refreshed first and their token is used.
 */

export class CompanyCamNotConnectedError extends Error {
  constructor() {
    super("CompanyCam isn't connected. The account owner connects it on Settings → Integrations.");
    this.name = "CompanyCamNotConnectedError";
  }
}

export class CompanyCamReconnectError extends Error {
  constructor() {
    super(
      "CompanyCam stopped accepting C Stream's access — this happens when the app is disconnected on CompanyCam's side. The account owner presses Reconnect on the CompanyCam card in Settings → Integrations.",
    );
    this.name = "CompanyCamReconnectError";
  }
}

export class CompanyCamNotConfiguredError extends Error {
  constructor() {
    super("CompanyCam isn't set up on this install yet.");
    this.name = "CompanyCamNotConfiguredError";
  }
}

/** Refresh when the token has less than this left. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

export type CompanyCamDeps = CompanyCamRequestDeps & { config?: CompanyCamConfig | null };

/** What the access envelope holds. */
export function sealAccess(tokens: Pick<CompanyCamTokens, "accessToken" | "expiresAt">): string {
  return encryptSecret(JSON.stringify({ t: tokens.accessToken, exp: tokens.expiresAt?.toISOString() ?? null }));
}

export function openAccess(envelope: string): { accessToken: string; expiresAt: Date | null } {
  const plain = decryptSecret(envelope);
  try {
    const parsed = JSON.parse(plain) as { t?: unknown; exp?: unknown };
    if (typeof parsed.t === "string") {
      const exp = typeof parsed.exp === "string" ? new Date(parsed.exp) : null;
      return { accessToken: parsed.t, expiresAt: exp && !Number.isNaN(exp.getTime()) ? exp : null };
    }
  } catch {
    // Not JSON: a bare token. Treated as expiry unknown -> refresh.
  }
  return { accessToken: plain, expiresAt: null };
}

async function loadConnection(companyId: string) {
  return prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "COMPANYCAM" } },
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
        message: "CompanyCam refused the stored credential. Reconnect to import photos again.",
        occurredAt: now,
      },
    });
  });
}

export function companyCamConfigOrThrow(deps: CompanyCamDeps = {}): CompanyCamConfig {
  const config = deps.config === undefined ? readCompanyCamConfig() : deps.config;
  if (!config) throw new CompanyCamNotConfiguredError();
  return config;
}

/** A usable access token for this company's CompanyCam connection. `force`
 * refreshes even if the token looks alive — used once after a 401. */
export async function companyCamAccessToken(
  companyId: string,
  options: { force?: boolean } = {},
  deps: CompanyCamDeps = {},
): Promise<string> {
  const config = companyCamConfigOrThrow(deps);
  const connection = await loadConnection(companyId);
  if (!connection || !connection.encryptedAccessToken || !connection.encryptedRefreshToken) {
    throw new CompanyCamNotConnectedError();
  }
  if (connection.status === "NEEDS_REAUTH") throw new CompanyCamReconnectError();
  if (connection.status !== "CONNECTED") throw new CompanyCamNotConnectedError();

  const access = openAccess(connection.encryptedAccessToken);
  const now = (deps.now ?? (() => new Date()))();
  if (!options.force && access.expiresAt && access.expiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS) {
    return access.accessToken;
  }

  let fresh: CompanyCamTokens;
  try {
    fresh = await refreshCompanyCamTokens(
      config,
      decryptSecret(connection.encryptedRefreshToken),
      deps.fetchImpl,
      deps.now,
    );
  } catch (error) {
    if (error instanceof CompanyCamAuthError && error.invalidGrant) {
      // Maybe another request rotated it a moment ago — if the stored
      // refresh envelope moved, that request won and its token is good.
      const again = await loadConnection(companyId);
      if (
        again?.encryptedRefreshToken &&
        again.encryptedRefreshToken !== connection.encryptedRefreshToken &&
        again.encryptedAccessToken
      ) {
        return openAccess(again.encryptedAccessToken).accessToken;
      }
      await markNeedsReauth(companyId, connection.id);
      throw new CompanyCamReconnectError();
    }
    throw error;
  }

  const swapped = await prisma.integrationConnection.updateMany({
    where: { id: connection.id, companyId, encryptedRefreshToken: connection.encryptedRefreshToken },
    data: { encryptedAccessToken: sealAccess(fresh), encryptedRefreshToken: encryptSecret(fresh.refreshToken) },
  });
  if (swapped.count === 1) return fresh.accessToken;

  // Lost the race: another request stored its pair first. Ours must NOT be
  // written; theirs is live.
  const winner = await loadConnection(companyId);
  if (winner?.encryptedAccessToken) return openAccess(winner.encryptedAccessToken).accessToken;
  throw new CompanyCamNotConnectedError();
}

/** Runs `fn` with a live token, refreshing and retrying ONCE on a 401. */
export async function withCompanyCamToken<T>(
  companyId: string,
  fn: (accessToken: string, config: CompanyCamConfig) => Promise<T>,
  deps: CompanyCamDeps = {},
): Promise<T> {
  const config = companyCamConfigOrThrow(deps);
  const token = await companyCamAccessToken(companyId, {}, { ...deps, config });
  try {
    return await fn(token, config);
  } catch (error) {
    if (!(error instanceof CompanyCamUnauthorizedError)) throw error;
    const fresh = await companyCamAccessToken(companyId, { force: true }, { ...deps, config });
    try {
      return await fn(fresh, config);
    } catch (again) {
      if (again instanceof CompanyCamUnauthorizedError) {
        const connection = await loadConnection(companyId);
        if (connection) await markNeedsReauth(companyId, connection.id);
        throw new CompanyCamReconnectError();
      }
      throw again;
    }
  }
}
