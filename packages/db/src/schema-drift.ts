/**
 * Marks a Prisma "the database does not have this" error so the error
 * boundary in the browser can tell it apart from every other failure.
 *
 * THE PROBLEM THIS SOLVES. A production build redacts a thrown server
 * error's message to "An error occurred in the Server Components render…"
 * and hands the client only `digest`. So `components/PageLoadError.tsx`
 * cannot read a Prisma code off the error — a missing column and a
 * thousands comma typed into an Amount field arrive looking identical. It
 * used to say "on a preview this is usually the database" for BOTH, and
 * for the second one that sent a person to run a migration workflow that
 * could not help (found by clicking, 2026-09-21).
 *
 * THE MECHANISM. Next.js generates a digest only when the error has none
 * (`create-error-handler.js`: "If the error already has a digest, respect
 * the original digest") — it is how `redirect()` and `notFound()` travel,
 * as `NEXT_REDIRECT…` digests. So a digest set HERE, before Next sees the
 * error, reaches the boundary verbatim. Wired in as a `$extends` query
 * hook on the Prisma client (src/index.ts), which sees every model
 * operation and every raw query, inside transactions too.
 *
 * ONLY P2021 (table does not exist) and P2022 (column does not exist).
 * Those two are what schema drift looks like — a migration the connected
 * database has not received — and nothing else is claimed. Every other
 * error passes through untouched and gets Next's own hash.
 *
 * Reads `code` rather than `instanceof PrismaClientKnownRequestError`,
 * which is FALSE at runtime in this app (see `isUniqueConstraintError` in
 * apps/web/lib/actions/shared.ts for the measurement).
 *
 * The prefix is duplicated ONCE, in apps/web/lib/schema-drift.ts, because
 * that file is imported by a client component and must not pull the Prisma
 * client into the browser bundle. `apps/web/lib/errorBoundaryCoverage.test.ts`
 * reads both files and fails if the two literals ever disagree.
 */

export const SCHEMA_DRIFT_DIGEST_PREFIX = "SCHEMA_DRIFT_";

const DRIFT_CODES = new Set(["P2021", "P2022"]);

export function isSchemaDriftError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && DRIFT_CODES.has(code);
}

/** Returns the same error, with a drift digest set when — and only when —
 * it is a P2021/P2022 that does not already carry a digest. */
export function markSchemaDrift<T>(err: T): T {
  if (!isSchemaDriftError(err)) return err;
  const target = err as unknown as { code: string; digest?: unknown };
  if (typeof target.digest === "string" && target.digest.length > 0) return err;
  target.digest = `${SCHEMA_DRIFT_DIGEST_PREFIX}${target.code}`;
  return err;
}
