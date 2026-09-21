/**
 * The browser-side half of `packages/db/src/schema-drift.ts`: recognises
 * the digest that file sets on a Prisma "table/column does not exist"
 * error, so `components/PageLoadError.tsx` can say "this is the database"
 * only when it is.
 *
 * A separate file, and a duplicated literal, on purpose: PageLoadError is
 * a client component, and importing `@prova/db` from it would pull the
 * Prisma client into the browser bundle. `errorBoundaryCoverage.test.ts`
 * reads both files and fails if the two prefixes disagree.
 */

export const SCHEMA_DRIFT_DIGEST_PREFIX = "SCHEMA_DRIFT_";

export function isSchemaDriftDigest(digest: string | undefined): boolean {
  return typeof digest === "string" && digest.startsWith(SCHEMA_DRIFT_DIGEST_PREFIX);
}
