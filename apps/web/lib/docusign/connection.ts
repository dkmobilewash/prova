import { prisma } from "@prova/db";
import {
  DocuSignAuthError,
  DocuSignUnauthorizedError,
  readDocuSignConfig,
  refreshDocuSignTokens,
  type DocuSignApiTarget,
  type FetchLike,
} from "@prova/integrations";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * One company's DocuSign credential: storage, refresh, and a live
 * `DocuSignApiTarget` to call the eSignature API with.
 *
 * STORAGE. Both halves are lib/crypto.ts envelopes on the generic
 * IntegrationConnection row (provider DOCUSIGN) — never a plaintext column,
 * never a log line, never anything returned to a page. The access half
 * carries the token AND what is needed to use it: when it expires (DocuSign
 * reports `expires_in`; there is no JWT to read it from) and the account's
 * `base_uri`. Keeping those inside the envelope means no new column on a
 * table shared by every provider. `externalAccountId` holds the DocuSign
 * account id in the clear — it is not a secret, and the webhook matches it.
 *
 * REFRESH IS A COMPARE-AND-SWAP, the Jobber arrangement: the new pair is
 * written only WHERE the stored refresh envelope is still the one this
 * request started from. DocuSign issues a new refresh token on every
 * refresh; whether the old one dies at once is not documented, so the code
 * assumes it does. Two requests refreshing together (a webhook and a
 * Refresh button a second apart) cannot then store a dead token over a live
 * one — the loser reads the winner's token and uses that.
 */

export class DocuSignNotConfiguredError extends Error {
  constructor() {
    super("DocuSign isn't set up on this install yet.");
    this.name = "DocuSignNotConfiguredError";
  }
}

export class DocuSignNotConnectedError extends Error {
  constructor() {
    super("DocuSign isn't connected. The account owner connects it on Settings → Integrations.");
    this.name = "DocuSignNotConnectedError";
  }
}

export class DocuSignReconnectError extends Error {
  constructor() {
    super(
      "DocuSign stopped accepting C Stream's access — this happens after about 30 days unused, or when the app is removed on DocuSign's side. The account owner presses Reconnect on Settings → Integrations.",
    );
    this.name = "DocuSignReconnectError";
  }
}

export type StoredAccess = { accessToken: string; expiresAt: string; baseUri: string };

export function sealAccess(access: StoredAccess): string {
  return encryptSecret(JSON.stringify(access));
}

export function openAccess(envelope: string): StoredAccess {
  const parsed = JSON.parse(decryptSecret(envelope)) as Partial<StoredAccess>;
  if (typeof parsed.accessToken !== "string" || typeof parsed.baseUri !== "string" || typeof parsed.expiresAt !== "string") {
    throw new Error("Stored DocuSign credential is not in the expected shape.");
  }
  return parsed as StoredAccess;
}

/** Refresh when less than this is left — DocuSign's own suggestion is
 * "within 30 minutes". */
export const DOCUSIGN_REFRESH_MARGIN_MS = 30 * 60 * 1000;

export type DocuSignDeps = { fetchImpl?: FetchLike; now?: () => Date };

async function loadConnection(companyId: string) {
  return prisma.integrationConnection.findUnique({
    where: { companyId_provider: { companyId, provider: "DOCUSIGN" } },
    select: {
      id: true,
      status: true,
      externalAccountId: true,
      encryptedAccessToken: true,
      encryptedRefreshToken: true,
    },
  });
}

export async function markDocuSignNeedsReauth(companyId: string, connectionId: string, now = new Date()) {
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
        message: "DocuSign refused the stored credential. Reconnect to send or track envelopes.",
        occurredAt: now,
      },
    });
  });
}

/** A live target for this company. `force` refreshes even if the token
 * looks alive — used once after a 401. */
export async function docuSignTarget(
  companyId: string,
  options: { force?: boolean } = {},
  deps: DocuSignDeps = {},
): Promise<DocuSignApiTarget> {
  const config = readDocuSignConfig();
  if (!config) throw new DocuSignNotConfiguredError();
  const connection = await loadConnection(companyId);
  if (!connection || !connection.encryptedAccessToken || !connection.encryptedRefreshToken || !connection.externalAccountId) {
    throw new DocuSignNotConnectedError();
  }
  if (connection.status === "NEEDS_REAUTH") throw new DocuSignReconnectError();
  if (connection.status !== "CONNECTED") throw new DocuSignNotConnectedError();

  const stored = openAccess(connection.encryptedAccessToken);
  const now = (deps.now ?? (() => new Date()))();
  const expiresAt = new Date(stored.expiresAt).getTime();
  const accountId = connection.externalAccountId;
  if (!options.force && Number.isFinite(expiresAt) && expiresAt - now.getTime() > DOCUSIGN_REFRESH_MARGIN_MS) {
    return { accessToken: stored.accessToken, baseUri: stored.baseUri, accountId };
  }

  let fresh;
  try {
    fresh = await refreshDocuSignTokens(config, decryptSecret(connection.encryptedRefreshToken), deps.fetchImpl);
  } catch (error) {
    if (error instanceof DocuSignAuthError && (error.invalidGrant || error.status === 400 || error.status === 401)) {
      // Maybe another request refreshed a moment ago — if the stored
      // refresh envelope moved, that request won and its token is good.
      const after = await loadConnection(companyId);
      if (after?.encryptedRefreshToken && after.encryptedRefreshToken !== connection.encryptedRefreshToken && after.encryptedAccessToken) {
        const winner = openAccess(after.encryptedAccessToken);
        return { accessToken: winner.accessToken, baseUri: winner.baseUri, accountId };
      }
      await markDocuSignNeedsReauth(companyId, connection.id, now);
      throw new DocuSignReconnectError();
    }
    throw error;
  }

  const access: StoredAccess = {
    accessToken: fresh.accessToken,
    expiresAt: new Date(now.getTime() + fresh.expiresIn * 1000).toISOString(),
    baseUri: stored.baseUri,
  };
  const swapped = await prisma.integrationConnection.updateMany({
    where: { id: connection.id, companyId, encryptedRefreshToken: connection.encryptedRefreshToken },
    data: { encryptedAccessToken: sealAccess(access), encryptedRefreshToken: encryptSecret(fresh.refreshToken) },
  });
  if (swapped.count === 1) return { accessToken: access.accessToken, baseUri: access.baseUri, accountId };

  // Lost the race: another request stored its pair first. Ours must NOT be
  // written; theirs is live.
  const winner = await loadConnection(companyId);
  if (winner?.encryptedAccessToken) {
    const won = openAccess(winner.encryptedAccessToken);
    return { accessToken: won.accessToken, baseUri: won.baseUri, accountId };
  }
  throw new DocuSignNotConnectedError();
}

/** Runs `fn` with a live target, refreshing and retrying ONCE on a 401. */
export async function withDocuSign<T>(
  companyId: string,
  fn: (target: DocuSignApiTarget) => Promise<T>,
  deps: DocuSignDeps = {},
): Promise<T> {
  const target = await docuSignTarget(companyId, {}, deps);
  try {
    return await fn(target);
  } catch (error) {
    if (!(error instanceof DocuSignUnauthorizedError)) throw error;
    const fresh = await docuSignTarget(companyId, { force: true }, deps);
    try {
      return await fn(fresh);
    } catch (again) {
      if (again instanceof DocuSignUnauthorizedError) {
        const connection = await loadConnection(companyId);
        if (connection) await markDocuSignNeedsReauth(companyId, connection.id);
        throw new DocuSignReconnectError();
      }
      throw again;
    }
  }
}
