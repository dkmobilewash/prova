import { prisma } from "@prova/db";
import { QuickBooksApiError, refreshTokens } from "@prova/integrations";

/**
 * A usable QuickBooks access token for one company, refreshing it when it is
 * within a minute of expiry. Returns null when there is no connection or
 * Intuit refused the refresh — the latter recorded on the connection as
 * NEEDS_REAUTH so the Settings page can say so.
 *
 * Moved here, unchanged, from lib/actions/quickbooks.ts when the QuickBooks
 * import (lib/actions/quickbooksImport.ts) became its second caller. It
 * cannot be exported from that file: everything a "use server" module
 * exports is a Server Action, an HTTP endpoint anyone can post to, and this
 * returns a bearer token.
 *
 * NOT A SERVER ACTION, AND NEVER IMPORT IT INTO A CLIENT COMPONENT.
 */
export async function accessTokenFor(companyId: string) {
  const connection = await prisma.quickBooksConnection.findUnique({ where: { companyId } });
  if (!connection) return null;

  if (connection.accessTokenExpiresAt.getTime() - Date.now() >= 60_000) {
    return { accessToken: connection.accessToken, realmId: connection.realmId };
  }

  // A refresh that fails is not a transient error and no retry fixes it:
  // Intuit rolls refresh tokens roughly every 100 days, and a person can
  // revoke the connection from inside QuickBooks at any moment. Either way
  // the only cure is somebody reconnecting.
  //
  // This used to throw straight out of here. In a production build Next
  // redacts a thrown Server Action message to a digest, so the person got
  // an opaque error on whatever page they were on and NOTHING anywhere said
  // the QuickBooks connection was the reason. Recording the state and
  // returning null turns a mystery into a sentence on the Integrations
  // page.
  let refreshed;
  try {
    refreshed = await refreshTokens(connection.refreshToken);
  } catch (error) {
    const detail =
      error instanceof QuickBooksApiError
        ? error.detail
        : "QuickBooks refused to renew the connection.";
    await prisma.quickBooksConnection.update({
      where: { companyId },
      data: { status: "NEEDS_REAUTH", statusDetail: detail, statusAt: new Date() },
    });
    return null;
  }

  await prisma.quickBooksConnection.update({
    where: { companyId },
    data: {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
      refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
      // A successful refresh clears it. Leaving a stale NEEDS_REAUTH on a
      // working connection would be its own lie, and this codebase has been
      // bitten by exactly that shape more than once.
      status: "CONNECTED",
      statusDetail: null,
      statusAt: new Date(),
    },
  });
  return { accessToken: refreshed.accessToken, realmId: connection.realmId };
}
