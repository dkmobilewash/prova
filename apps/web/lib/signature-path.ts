/**
 * The drawn-signature format shared by timesheet sign-offs and T&M tickets.
 * No imports on purpose: a client component (SignatureImage) reads these
 * constants, and this must never pull the database client into a browser
 * bundle.
 */

export const SIGNATURE_WIDTH = 320;
export const SIGNATURE_HEIGHT = 160;
/** Generous for a signature (a few thousand points) and small enough that a
 * row cannot be used as storage. */
export const SIGNATURE_MAX_LENGTH = 40_000;

/**
 * The one shape a drawn signature may take: `M<x> <y>` starts a stroke and
 * `L<x> <y>` continues it, whole pixels inside the 320x160 box the phone
 * draws on. Anything else — curves, letters, markup — is refused, so a
 * stored signature is safe to hand straight to an SVG `d` attribute.
 */
export function isValidSignaturePath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > SIGNATURE_MAX_LENGTH) return false;
  if (!/^M\d{1,3} \d{1,3}(?:[ML]\d{1,3} \d{1,3})*$/.test(path)) return false;
  for (const [, x, y] of path.matchAll(/[ML](\d+) (\d+)/g)) {
    if (Number(x) > SIGNATURE_WIDTH || Number(y) > SIGNATURE_HEIGHT) return false;
  }
  return true;
}
