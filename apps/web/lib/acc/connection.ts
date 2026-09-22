import { prisma } from "@prova/db";
import {
  AccAuthError,
  AccUnauthorizedError,
  readAccConfig,
  refreshAccTokens,
  type AccConfig,
  type AccRequestDeps,
  type AccTokens,
} from "@prova/integrations";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * The server side of talking to ACC for one company: the stored credential
 * and its refresh. Same design as lib/procore/connection.ts, and for the
 * same reasons — read that file's header first.
 *
 * TOKENS. Stored only as AES-256-GCM envelopes (lib/crypto.ts) in
 * IntegrationConnection.encryptedAccessToken/RefreshToken, never in a log
 * line, an error message or anything returned to a page. The access
 * envelope holds the token AND its expiry (APS's token response says
 * `expires_in`; the token itself is opaque).
 *
 * REFRESH IS A COMPARE-AND-SWAP, same as Procore's, for the same reason:
 * whether or not APS rotates refresh tokens on use is NOT VERIFIED (see
 * packages/integrations/src/acc.ts's notes), so this is written to be safe
 * either way. Two requests refreshing together (the on-open refresh and a
 * Refresh press, two tabs) must not let the loser's write clobber the
 * winner's — so the new pair is written only WHERE the stored refresh
 * envelope is still the one this request started from.
 */

export class AccNotConnectedError extends Error {
  constructor() {
    super("Autodesk Construction Cloud isn't connected. The account owner connects it on Settings → Integrations.");
    this.name = "AccNotConnectedError";
  }
}

export class AccReconnectError extends Error {
  constructor() {
    super(
      "Autodesk stopped accepting C Stream's access — this happens when the app is removed on Autodesk's side. The account owner presses Reconnect on the ACC card in Settings → Integrations.",
    );
    this.name = "AccReconnectError";
  }
}

export class AccNotConfiguredError extends Error {
  constructor() {
    super("Autodesk Construction Cloud isn't set up on this install yet.");
    this.name = "AccNotConfiguredError";
  }
}

/** Refresh when the token has less than this left. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

export type AccDeps = AccRequestDeps & { config?: AccConfig | null };

/** What the access envelope holds. */
export function sealAccess(tokens: Pick<AccTokens, "accessToken" | "expiresAt">): string {
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
    where: { companyId_provider: { companyId, provider: "ACC" } },
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
        message: "Autodesk refused the stored credential. Reconnect to read from ACC again.",
        occurredAt: now,
      },
    });
  });
}

export function accConfigOrThrow(deps: AccDeps = {}): AccConfig {
  const config = deps.config === undefined ? readAccConfig() : deps.config;
  if (!config) throw new AccNotConfiguredError();
  return config;
}

/** A usable access token for this company's ACC connection. `force`
 * refreshes even if the token looks alive — used once after a 401. */
export async function accAccessToken(
  companyId: string,
  options: { force?: boolean } = {},
  deps: AccDeps = {},
): Promise<string> {
  const config = accConfigOrThrow(deps);
  const connection = await loadConnection(companyId);
  if (!connection || !connection.encryptedAccessToken || !connection.encryptedRefreshToken) {
    throw new AccNotConnectedError();
  }
  if (connection.status === "NEEDS_REAUTH") throw new AccReconnectError();
  if (connection.status !== "CONNECTED") throw new AccNotConnectedError();

  const access = openAccess(connection.encryptedAccessToken);
  const now = (deps.now ?? (() => new Date()))();
  if (!options.force && access.expiresAt && access.expiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS) {
    return access.accessToken;
  }

  let fresh: AccTokens;
  try {
    fresh = await refreshAccTokens(config, decryptSecret(connection.encryptedRefreshToken), deps.fetchImpl, deps.now);
  } catch (error) {
    if (error instanceof AccAuthError && error.invalidGrant) {
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
      throw new AccReconnectError();
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
  throw new AccNotConnectedError();
}

/** Runs `fn` with a live token, refreshing and retrying ONCE on a 401. */
export async function withAccToken<T>(
  companyId: string,
  fn: (accessToken: string, config: AccConfig) => Promise<T>,
  deps: AccDeps = {},
): Promise<T> {
  const config = accConfigOrThrow(deps);
  const token = await accAccessToken(companyId, {}, { ...deps, config });
  try {
    return await fn(token, config);
  } catch (error) {
    if (!(error instanceof AccUnauthorizedError)) throw error;
    const fresh = await accAccessToken(companyId, { force: true }, { ...deps, config });
    try {
      return await fn(fresh, config);
    } catch (again) {
      if (again instanceof AccUnauthorizedError) {
        const connection = await loadConnection(companyId);
        if (connection) await markNeedsReauth(companyId, connection.id);
        throw new AccReconnectError();
      }
      throw again;
    }
  }
}
