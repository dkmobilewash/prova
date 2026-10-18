import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * THE UNSUBSCRIBE LINK'S TOKEN: `<leadId>.<first 24 hex of HMAC-SHA256>`.
 *
 * Stateless on purpose — nothing is stored per email, so every link ever sent
 * keeps working for as long as the secret does, which is what CAN-SPAM asks of
 * an opt-out (it must work for 30 days after the send, and there is no reason
 * to let it stop). The lead id alone would let anyone who saw one link
 * unsubscribe every other lead by guessing ids; the HMAC is what stops that.
 *
 * 24 hex is 96 bits — far past guessable, and short enough that a link pasted
 * into an email client is not wrapped.
 *
 * ROTATING `OUTBOUND_TOKEN_SECRET` KILLS EVERY LINK ALREADY SENT. Do not.
 */

const TAG_HEX = 24;

function tag(leadId: string, secret: string): string {
  return createHmac("sha256", secret).update(leadId).digest("hex").slice(0, TAG_HEX);
}

export function unsubscribeTokenFor(leadId: string, secret = process.env.OUTBOUND_TOKEN_SECRET?.trim()): string {
  // A bug, not a refusal: every caller checks the secret before it gets here
  // (see `outboundConfig`), because an email without a working opt-out must
  // never be sent.
  if (!secret) throw new Error("OUTBOUND_TOKEN_SECRET is not set");
  return `${leadId}.${tag(leadId, secret)}`;
}

/** The lead id, or null for anything that is not a token this secret made. */
export function leadIdFromToken(token: string, secret = process.env.OUTBOUND_TOKEN_SECRET?.trim()): string | null {
  if (!secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const leadId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "utf8");
  const expected = Buffer.from(tag(leadId, secret), "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected) ? leadId : null;
}
