import { prisma } from "@prova/db";
import {
  ProcoreAuthError,
  ProcoreUnauthorizedError,
  readProcoreConfig,
  refreshProcoreTokens,
  type ProcoreConfig,
  type ProcoreRequestDeps,
  type ProcoreTokens,
} from "@prova/integrations";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * The server side of talking to Procore for one company: the stored
 * credential and its refresh. Same design as lib/jobber/connection.ts, and
 * for the same reasons.
 *
 * TOKENS. Stored only as AES-256-GCM envelopes (lib/crypto.ts) in
 * IntegrationConnection.encryptedAccessToken/RefreshToken, never in a log
 * line, an error message or anything returned to a page. The access
 * envelope holds the token AND its expiry (Procore's token response says
 * `expires_in`; the token itself is opaque, so unlike Jobber's JWT there is
 * nothing to read the expiry back out of). Keeping both in the one envelope
 * means no schema column for it and no way for the two to disagree.
 *
 * REFRESH IS A COMPARE-AND-SWAP. Procore refresh tokens are single-use: a
 * refresh returns a new one and the old one is spent. Two requests
 * refreshing together (the on-open refresh and a Refresh press, two tabs)
 * both spend the same token; the loser's answer is `invalid_grant`, and if
 * the loser's WRITE landed last it would store a dead token and break the
 * connection for good. So the new pair is written only WHERE the stored
 * refresh envelope is still the one this request started from; if nothing
 * matched, somebody else refreshed first and their token is used.
 */

export class ProcoreNotConnectedError extends Error {
  constructor() {
    super("Procore isn't connected. The account owner connects it on Settings → Integrations.");
    this.name = "ProcoreNotConnectedError";
  }
}

export class ProcoreReconnectError extends Error {
  constructor() {
    super(
      "Procore stopped accepting C Stream's access — this happens when the app is disconnected on Procore's side. The account owner presses Reconnect on the Procore card in Settings → Integrations.",
    );
    this.name = "ProcoreReconnectError";
  }
}

export class ProcoreNotConfiguredError extends Error {
  constructor() {
    super("Procore isn't set up on this install yet.");
    this.name = "ProcoreNotConfiguredError";
  }
}

/** Refresh when the token has less than this left. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

export type ProcoreDeps = ProcoreRequestDeps & { config?: ProcoreConfig | null };

/** What the access envelope holds. */
export function sealAccess(tokens: Pick<ProcoreTokens, "accessToken" | "expiresAt">): string {
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
    where: { companyId_provider: { companyId, provider: "PROCORE" } },
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
        message: "Procore refused the stored credential. Reconnect to read from Procore again.",
        occurredAt: now,
      },
    });
  });
}

export function procoreConfigOrThrow(deps: ProcoreDeps = {}): ProcoreConfig {
  const config = deps.config === undefined ? readProcoreConfig() : deps.config;
  if (!config) throw new ProcoreNotConfiguredError();
  return config;
}

/** A usable access token for this company's Procore connection. `force`
 * refreshes even if the token looks alive — used once after a 401. */
export async function procoreAccessToken(
  companyId: string,
  options: { force?: boolean } = {},
  deps: ProcoreDeps = {},
): Promise<string> {
  const config = procoreConfigOrThrow(deps);
  const connection = await loadConnection(companyId);
  if (!connection || !connection.encryptedAccessToken || !connection.encryptedRefreshToken) {
    throw new ProcoreNotConnectedError();
  }
  if (connection.status === "NEEDS_REAUTH") throw new ProcoreReconnectError();
  if (connection.status !== "CONNECTED") throw new ProcoreNotConnectedError();

  const access = openAccess(connection.encryptedAccessToken);
  const now = (deps.now ?? (() => new Date()))();
  if (!options.force && access.expiresAt && access.expiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS) {
    return access.accessToken;
  }

  let fresh: ProcoreTokens;
  try {
    fresh = await refreshProcoreTokens(config, decryptSecret(connection.encryptedRefreshToken), deps.fetchImpl, deps.now);
  } catch (error) {
    if (error instanceof ProcoreAuthError && error.invalidGrant) {
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
      throw new ProcoreReconnectError();
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
  throw new ProcoreNotConnectedError();
}

/** Runs `fn` with a live token, refreshing and retrying ONCE on a 401. */
export async function withProcoreToken<T>(
  companyId: string,
  fn: (accessToken: string, config: ProcoreConfig) => Promise<T>,
  deps: ProcoreDeps = {},
): Promise<T> {
  const config = procoreConfigOrThrow(deps);
  const token = await procoreAccessToken(companyId, {}, { ...deps, config });
  try {
    return await fn(token, config);
  } catch (error) {
    if (!(error instanceof ProcoreUnauthorizedError)) throw error;
    const fresh = await procoreAccessToken(companyId, { force: true }, { ...deps, config });
    try {
      return await fn(fresh, config);
    } catch (again) {
      if (again instanceof ProcoreUnauthorizedError) {
        const connection = await loadConnection(companyId);
        if (connection) await markNeedsReauth(companyId, connection.id);
        throw new ProcoreReconnectError();
      }
      throw again;
    }
  }
}
