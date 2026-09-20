import { prisma } from "@prova/db";
import {
  BluebeamAuthError,
  BluebeamUnauthorizedError,
  readBluebeamConfig,
  refreshBluebeamTokens,
  type BluebeamApiTarget,
  type BluebeamConfig,
} from "@prova/integrations";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * One company's Bluebeam credential: storage, refresh, and a live
 * `BluebeamApiTarget` to call the Studio API with.
 *
 * Same design as lib/companycam/connection.ts and lib/docusign/
 * connection.ts, and for the same reasons — see those files' own
 * comments for the fuller version of each point below.
 *
 * STORAGE: AES-256-GCM envelopes (lib/crypto.ts) on the generic
 * IntegrationConnection row (provider BLUEBEAM), never a plaintext
 * column. Unlike QuickBooks (open issue #353: its tokens ARE plaintext,
 * on its own pre-framework table), Bluebeam's tokens never touch a
 * column that isn't one of these two envelopes.
 *
 * REFRESH IS A COMPARE-AND-SWAP: the new pair is written only WHERE the
 * stored refresh envelope is still the one this request started from, so
 * two requests refreshing together cannot store a dead token over a live
 * one — the loser reads the winner's token and uses that.
 */

export class BluebeamNotConfiguredError extends Error {
  constructor() {
    super("Bluebeam isn't set up on this install yet.");
    this.name = "BluebeamNotConfiguredError";
  }
}

export class BluebeamNotConnectedError extends Error {
  constructor() {
    super("Bluebeam isn't connected. The account owner connects it on Settings → Integrations.");
    this.name = "BluebeamNotConnectedError";
  }
}

export class BluebeamReconnectError extends Error {
  constructor() {
    super(
      "Bluebeam stopped accepting C Stream's access — this happens after about 7 days unused, or when the app is removed on Bluebeam's side. The account owner presses Reconnect on Settings → Integrations.",
    );
    this.name = "BluebeamReconnectError";
  }
}

export type StoredAccess = { accessToken: string; expiresAt: string };

export function sealAccess(access: StoredAccess): string {
  return encryptSecret(JSON.stringify(access));
}

export function openAccess(envelope: string): StoredAccess {
  const parsed = JSON.parse(decryptSecret(envelope)) as Partial<StoredAccess>;
  if (typeof parsed.accessToken !== "string" || typeof parsed.expiresAt !== "string") {
    throw new Error("Stored Bluebeam credential is not in the expected shape.");
  }
  return parsed as StoredAccess;
}

/** Refresh when less than this is left. */
export const BLUEBEAM_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type BluebeamDeps = { fetchImpl?: typeof fetch; now?: () => Date; config?: BluebeamConfig | null };

async function loadConnection(companyId: string) {
  return prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "BLUEBEAM" } },
    select: { id: true, status: true, encryptedAccessToken: true, encryptedRefreshToken: true },
  });
}

export async function markBluebeamNeedsReauth(companyId: string, connectionId: string, now = new Date()) {
  await prisma.$transaction(async (tx) => {
    await tx.integrationConnection.updateMany({
      where: { id: connectionId, companyId },
      data: { status: "NEEDS_REAUTH", lastSyncedAt: now, lastSyncStatus: "FAILURE" },
    });
    await tx.integrationSyncLog.create({
      data: {
        connectionId,
        direction: "PUSH",
        status: "FAILURE",
        message: "Bluebeam refused the stored credential. Reconnect to push documents or refresh a session.",
        occurredAt: now,
      },
    });
  });
}

export function bluebeamConfigOrThrow(deps: BluebeamDeps = {}): BluebeamConfig {
  const config = deps.config === undefined ? readBluebeamConfig() : deps.config;
  if (!config) throw new BluebeamNotConfiguredError();
  return config;
}

/** A live target for this company. `force` refreshes even if the token
 * looks alive — used once after a 401. */
export async function bluebeamTarget(companyId: string, options: { force?: boolean } = {}, deps: BluebeamDeps = {}): Promise<BluebeamApiTarget> {
  const config = bluebeamConfigOrThrow(deps);
  const connection = await loadConnection(companyId);
  if (!connection || !connection.encryptedAccessToken || !connection.encryptedRefreshToken) {
    throw new BluebeamNotConnectedError();
  }
  if (connection.status === "NEEDS_REAUTH") throw new BluebeamReconnectError();
  if (connection.status !== "CONNECTED") throw new BluebeamNotConnectedError();

  const stored = openAccess(connection.encryptedAccessToken);
  const now = (deps.now ?? (() => new Date()))();
  const expiresAt = new Date(stored.expiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - now.getTime() > BLUEBEAM_REFRESH_MARGIN_MS && !options.force) {
    return { accessToken: stored.accessToken, host: config.host };
  }

  let fresh;
  try {
    fresh = await refreshBluebeamTokens(config, decryptSecret(connection.encryptedRefreshToken), deps.fetchImpl);
  } catch (error) {
    if (error instanceof BluebeamAuthError && (error.invalidGrant || error.status === 400 || error.status === 401)) {
      const after = await loadConnection(companyId);
      if (after?.encryptedRefreshToken && after.encryptedRefreshToken !== connection.encryptedRefreshToken && after.encryptedAccessToken) {
        return { accessToken: openAccess(after.encryptedAccessToken).accessToken, host: config.host };
      }
      await markBluebeamNeedsReauth(companyId, connection.id, now);
      throw new BluebeamReconnectError();
    }
    throw error;
  }

  const access: StoredAccess = { accessToken: fresh.accessToken, expiresAt: new Date(now.getTime() + fresh.expiresIn * 1000).toISOString() };
  const swapped = await prisma.integrationConnection.updateMany({
    where: { id: connection.id, companyId, encryptedRefreshToken: connection.encryptedRefreshToken },
    data: { encryptedAccessToken: sealAccess(access), encryptedRefreshToken: encryptSecret(fresh.refreshToken) },
  });
  if (swapped.count === 1) return { accessToken: access.accessToken, host: config.host };

  const winner = await loadConnection(companyId);
  if (winner?.encryptedAccessToken) return { accessToken: openAccess(winner.encryptedAccessToken).accessToken, host: config.host };
  throw new BluebeamNotConnectedError();
}

/** Runs `fn` with a live target, refreshing and retrying ONCE on a 401. */
export async function withBluebeam<T>(companyId: string, fn: (target: BluebeamApiTarget) => Promise<T>, deps: BluebeamDeps = {}): Promise<T> {
  const target = await bluebeamTarget(companyId, {}, deps);
  try {
    return await fn(target);
  } catch (error) {
    if (!(error instanceof BluebeamUnauthorizedError)) throw error;
    const fresh = await bluebeamTarget(companyId, { force: true }, deps);
    try {
      return await fn(fresh);
    } catch (again) {
      if (again instanceof BluebeamUnauthorizedError) {
        const connection = await loadConnection(companyId);
        if (connection) await markBluebeamNeedsReauth(companyId, connection.id);
        throw new BluebeamReconnectError();
      }
      throw again;
    }
  }
}
