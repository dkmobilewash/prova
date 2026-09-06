/**
 * Deciding whether the write that just arrived is the SAME write that
 * arrived a moment ago.
 *
 * Why this file exists at all: issue #61 established that a write in
 * production takes five to seven seconds to surface. A person who clicks
 * and sees nothing happen clicks again. #19 disabled 57 create buttons
 * while their form is in flight, which helps a double-click on one tab and
 * does nothing at all for a retry, a refresh-and-resubmit, or a second
 * device — the button is on this side of the network and the duplicate is
 * made on the other. Nothing in this codebase made the ACTION idempotent,
 * so ten money and evidence paths would each write a second row. See #102.
 *
 * Everything here is pure — no Prisma, no Next — so the two decisions that
 * actually matter can be executed in a test with real inputs rather than
 * inspected in a diff:
 *
 *   - is this prior row recent enough to be a repeat of the same click?
 *   - do two submissions hash to the same lock key?
 *
 * The lock key is derived HERE rather than by Postgres (`hashtextextended`
 * would have done it) for exactly that reason: a key computed in the
 * database is a key no unit test can check, and if two logically identical
 * submissions ever hashed differently the serialization would silently stop
 * working with every test still green. That is the "written, documented and
 * never called" shape CLAUDE.md warns about, one level down.
 */

import { createHash } from "node:crypto";

/**
 * How long after a write an identical one reads as a repeat rather than as
 * a second, real thing.
 *
 * Two minutes, the same figure as DUPLICATE_PUSH_WINDOW_MS in
 * quickbooks-sync.ts, and chosen the same way: long enough to cover the
 * five-to-seven second lag of #61 plus a person waiting, re-reading the
 * page and clicking again, and short enough that a deliberate second entry
 * — a second check from the same GC, a second half-day for the same
 * employee — is not silently swallowed. It is a bound on ACCIDENT, not a
 * business rule, which is why nothing in the app displays it.
 */
export const DUPLICATE_WRITE_WINDOW_MS = 2 * 60 * 1000;

/**
 * Is the row we already hold recent enough to be this same submission?
 *
 * `null` means there is no matching row at all, which is the ordinary
 * first-time case and must never read as a repeat — getting this backwards
 * would refuse every write in the app, which is why it has its own test.
 */
export function isRepeatOf(
  priorCreatedAt: Date | null | undefined,
  now: Date,
  windowMs: number = DUPLICATE_WRITE_WINDOW_MS,
): boolean {
  if (priorCreatedAt == null) return false;
  const elapsed = now.getTime() - priorCreatedAt.getTime();
  // Negative elapsed means clock skew between Postgres and this process.
  // Reading it as a repeat is the safe direction: a row stamped in the
  // future is certainly not a considered second entry made later.
  if (elapsed < 0) return true;
  return elapsed < windowMs;
}

export type FingerprintPart = string | number | boolean | Date | null | undefined;

/**
 * Money as a fingerprint part.
 *
 * "10000", "10000.00" and 10000 are the same payment and must produce the
 * same lock key — a form posts whichever the person typed. Without this,
 * two concurrent submissions of the same amount take two different locks
 * and the serialization below protects nothing.
 */
export function moneyPart(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toFixed(2);
}

/** Stable text for a set of identity fields. JSON, so that `["a", "b"]` and
 * `["a|b"]` cannot collide the way a joined string lets them. */
export function writeFingerprint(scope: string, parts: FingerprintPart[]): string {
  return JSON.stringify([
    scope,
    ...parts.map((part) => {
      if (part === undefined) return null;
      if (part instanceof Date) return part.toISOString();
      return part;
    }),
  ]);
}

/**
 * The 64-bit key for `pg_advisory_xact_lock`.
 *
 * Postgres advisory locks are keyed by bigint, so the fingerprint is hashed
 * down to one. SHA-256's first eight bytes, read as a SIGNED 64-bit integer
 * because that is what int8 is — an unsigned value above 2^63 would be out
 * of range and the lock call would fail at runtime, on exactly the busy
 * path this exists to protect.
 *
 * Collisions between unrelated scopes are possible in principle and
 * harmless in practice: the consequence is that two unrelated writes
 * briefly serialize with each other. The lock is a serialization device,
 * never the duplicate test itself — the test is the query that follows it,
 * against the real columns.
 */
export function advisoryLockKey(scope: string, parts: FingerprintPart[]): bigint {
  const digest = createHash("sha256").update(writeFingerprint(scope, parts)).digest("hex");
  return BigInt.asIntN(64, BigInt(`0x${digest.slice(0, 16)}`));
}
