/**
 * The exact columns the Integrations page reads.
 *
 * The page renders no credential, so today nothing leaks. But
 * `findMany({ where })` with no `select` returns every column, encrypted
 * envelopes included, into a server component — and a server component is
 * one prop away from a client one. Passing that object to a client
 * component would serialise those columns into the RSC payload and ship
 * them to a browser, with nothing on screen to show it happened.
 *
 * Naming the columns makes that impossible rather than merely unlikely: the
 * envelopes are not in the object, so they cannot be forwarded out of it.
 * The test beside this file fails if either one is ever added.
 *
 * They are omitted rather than obscured because the page has no use for
 * them. A credential is read server-side, at the moment a provider is
 * called, by the code doing the calling — never fetched "just in case" by a
 * page that renders status.
 */
export const CONNECTION_CARD_SELECT = {
  id: true,
  provider: true,
  status: true,
  externalAccountLabel: true,
  scopes: true,
  connectedAt: true,
  lastSyncedAt: true,
  lastSyncStatus: true,
} as const;

/** Every field on IntegrationConnection that holds a credential. */
export const CREDENTIAL_FIELDS = ["encryptedAccessToken", "encryptedRefreshToken"] as const;
