import { decryptSecret, encryptSecret, integrationEncryptionConfigured } from "@/lib/crypto";

/**
 * QuickBooks tokens at rest, sealed the way Jobber, Procore, DocuSign and
 * ACC's already are (#353 finding 4).
 *
 * `QuickBooksConnection.accessToken` / `.refreshToken` were plaintext while
 * every later integration went through `lib/crypto.ts` — the one connection
 * that reaches a contractor's BOOKS was the one a database read handed over
 * in the clear. This module is the seam: every write goes through
 * `sealQuickBooksToken`, every read through `openQuickBooksToken`, and the
 * two accept what the other produced AND what was there before them.
 *
 * WHY THE KEY IS OPTIONAL HERE AND MANDATORY FOR JOBBER. `quickBooksSetup`
 * deliberately does not require `INTEGRATION_TOKEN_KEY` (its own comment
 * says why), and production has a live connection written before this
 * existed. Making the key a hard requirement would break that connection's
 * next refresh on a deployment where the key has not been set yet, with a
 * digest for an error. So: with the key present, tokens are sealed; without
 * it they are stored as they always were, and the server log says so ONCE
 * per process rather than on every write. Reads never need to know which
 * happened — an envelope is opened, anything else is returned as-is.
 *
 * A legacy plaintext row becomes sealed on its next refresh, because the
 * refresh path writes both tokens back through `sealQuickBooksToken`.
 */

const ENVELOPE = /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]*$/;

let warnedOnce = false;

export function sealQuickBooksToken(plaintext: string): string {
  if (integrationEncryptionConfigured()) return encryptSecret(plaintext);
  if (!warnedOnce) {
    warnedOnce = true;
    console.warn(
      "[quickbooks] INTEGRATION_TOKEN_KEY is not set, so QuickBooks tokens are stored unencrypted. " +
        "Set it (openssl rand -base64 32) and they seal on the next refresh.",
    );
  }
  return plaintext;
}

/** Whether a stored value is one of ours. Exported for the test only. */
export function isSealedQuickBooksToken(stored: string): boolean {
  return ENVELOPE.test(stored);
}

export function openQuickBooksToken(stored: string): string {
  return isSealedQuickBooksToken(stored) ? decryptSecret(stored) : stored;
}

/** Reset the once-only warning between tests. Not for application code. */
export function _resetQuickBooksTokenStorageForTests() {
  warnedOnce = false;
}
