import { randomBytes } from "node:crypto";

/**
 * The one generator for links that ARE their own access control.
 *
 * Two of these exist: `Contact.portalToken` (the client portal) and
 * `SignatureRequest.token` (the e-signature page). Neither URL sits behind a
 * login — there is no client login yet — so the token in the path is the
 * whole of the authentication, and anyone holding it can read a company's
 * contract and, on the e-sign page, legally sign it.
 *
 * They were NOT generated the same way. The portal token was
 * `randomBytes(24)`; the e-sign token was Prisma's `@default(cuid())`, which
 * is an identifier generator — timestamp, per-process counter, machine
 * fingerprint, short random block — and has never claimed unguessability.
 * The schema comment asserted the two shared "the same access-control
 * pattern", which was true of their role and false of their entropy. A
 * function is the only version of that claim that cannot drift: there is now
 * one place the bytes come from, and both callers name it.
 *
 * 24 bytes = 192 bits, hex-encoded to 48 characters. Sized to be safe rather
 * than pretty: these links are pasted into emails to GCs and insurers, so
 * they leak by ordinary use and the only defence left is that a token nobody
 * was given cannot be reached by trying.
 */
const LINK_TOKEN_BYTES = 24;

export function linkToken(): string {
  return randomBytes(LINK_TOKEN_BYTES).toString("hex");
}
