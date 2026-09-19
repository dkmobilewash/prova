import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/crypto";

/**
 * DocuSign Connect's HMAC check — verified 2026-09-18 against
 * developers.docusign.com /platform/webhooks/connect/hmac/ and /validate/:
 *
 *   - the signature is HMAC-SHA256 over the ENTIRE request body, as bytes,
 *     line endings included, then base64-encoded;
 *   - one header per HMAC key defined on the account, named
 *     X-DocuSign-Signature-1, -2, … (up to 100);
 *   - "Only one match is required";
 *   - "If the secret has any \" characters, remove them before the
 *     computation."
 *
 * So the body must be the RAW bytes the request carried. Parsing it and
 * re-serialising would change whitespace and break every signature — the
 * route hands this the untouched buffer.
 *
 * Constant-time compare via lib/crypto.ts `safeEqual`, which exists for
 * exactly this. A key that is missing or empty verifies NOTHING: this
 * function cannot be configured into accepting unsigned messages.
 */

export const DOCUSIGN_MAX_SIGNATURE_HEADERS = 100;

export function docuSignSignature(body: Uint8Array | string, key: string): string {
  return createHmac("sha256", key.replace(/"/g, "")).update(body).digest("base64");
}

type HeaderReader = { get(name: string): string | null };

export function verifyDocuSignSignature(body: Uint8Array | string, headers: HeaderReader, key: string | undefined): boolean {
  const secret = key?.replace(/"/g, "").trim();
  if (!secret) return false;
  const expected = docuSignSignature(body, secret);
  for (let i = 1; i <= DOCUSIGN_MAX_SIGNATURE_HEADERS; i++) {
    const provided = headers.get(`x-docusign-signature-${i}`);
    if (provided === null) break;
    if (safeEqual(provided.trim(), expected)) return true;
  }
  return false;
}
