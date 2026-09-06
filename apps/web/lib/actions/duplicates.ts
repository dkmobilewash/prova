/**
 * The one line that turns a duplicate CHECK into a duplicate GUARD.
 *
 * Every path fixed under #102 has the same shape: inside a transaction,
 * look for the row this submission would duplicate, and only insert if it
 * is not there. On its own that is still a race — Prisma runs at Postgres's
 * default READ COMMITTED, where two concurrent transactions both run their
 * SELECT, both see nothing, and both INSERT. Being "inside the
 * transaction" narrows the window; it does not close it, and a guard that
 * only narrows a window is the thing #102 says is not a guard.
 *
 * `lockAgainstDuplicates` closes it. `pg_advisory_xact_lock` blocks until
 * no other transaction holds the same key, and releases on COMMIT or
 * ROLLBACK with no unlock call to forget — so two submissions of the same
 * logical write are serialized, the first inserts, and the second's check
 * runs AFTER the first is visible and finds it.
 *
 * Called as the FIRST statement inside the transaction, before the check
 * and before any sequence number is issued. A lock taken after the counter
 * has been bumped would still burn a number on the refused submission, and
 * this project's counters never reissue — the filed RFI log would be left
 * with a gap and nothing on the document to explain it.
 *
 * Safe on the Neon pooler: PgBouncer in transaction-pooling mode breaks
 * session-scoped advisory locks (`pg_advisory_lock`) because the connection
 * goes back to the pool mid-session. The `_xact_` variant is scoped to the
 * transaction, which is exactly the unit PgBouncer keeps on one connection,
 * so it is the one variant that is correct there. Do not "simplify" it to
 * the session form.
 *
 * Deliberately NOT a "use server" module and deliberately not re-exported
 * from ./index.ts — same reasoning as shared.ts: it exports a helper that
 * takes a transaction client, which is not a thing a Server Action may be.
 */

import type { Prisma } from "@prova/db";
import { advisoryLockKey, type FingerprintPart } from "@/lib/duplicate-writes";

export async function lockAgainstDuplicates(
  tx: Prisma.TransactionClient,
  scope: string,
  parts: FingerprintPart[],
): Promise<void> {
  const key = advisoryLockKey(scope, parts);
  // Cast to text, and not for style: `pg_advisory_xact_lock` returns void,
  // and Prisma's raw-query deserializer fails on a void column with
  // "Failed to deserialize column of type 'void'" — so the uncast version
  // throws on every call, on every path this protects. Measured against a
  // real Postgres, not guessed.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key})::text AS locked`;
}
