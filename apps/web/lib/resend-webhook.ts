import crypto from "node:crypto";

/** Svix-style signature check, which is what Resend uses on every webhook
 * it sends — delivery events and received email alike.
 *
 * EXTRACTED VERBATIM from app/api/messages/webhook/route.ts when the
 * inbound intake route became its second caller. A second copy of a
 * signature check is worse than a second copy of an allowlist: the copies
 * would agree until one was fixed.
 *
 * The signed content is `${id}.${timestamp}.${body}` — the raw body bytes
 * exactly as sent, never re-serialised JSON — keyed with the base64-decoded
 * secret (the `whsec_` prefix stripped), HMAC-SHA256, base64.
 *
 * Compares with a timing-safe equality — a plain === on a signature leaks
 * how much of it was right, one byte at a time. */
export function verifyResendSignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
  header: string,
): boolean {
  const base = `${secret.startsWith("whsec_") ? secret.slice(6) : secret}`;
  let key: Buffer;
  try {
    key = Buffer.from(base, "base64");
  } catch {
    return false;
  }

  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");

  // The header carries a space-separated list of versioned signatures, so a
  // provider can rotate keys without a flag day. Any one matching is enough.
  for (const part of header.split(" ")) {
    const value = part.includes(",") ? part.slice(part.indexOf(",") + 1) : part;
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** Signing a payload the same way, for tests that need a valid header. */
export function signResendPayload(secret: string, id: string, timestamp: string, body: string): string {
  const base = `${secret.startsWith("whsec_") ? secret.slice(6) : secret}`;
  const key = Buffer.from(base, "base64");
  const digest = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${digest}`;
}
