/**
 * What every bulk import's confirm shares: the transaction it writes in and
 * the sentence it returns when two imports collide.
 *
 * Lifted out of lib/actions/spreadsheetImport.ts when the Jobber import
 * (lib/actions/jobber.ts) became a second caller. It cannot live in either
 * action file: a "use server" module may only export async functions.
 *
 * WHY SERIALIZABLE. Idempotency in an import is a read-then-write: "skip
 * what already exists, create the rest". Read outside the transaction, a
 * double-click or two tabs confirming at once would both see nothing there
 * and both create everything. Serializable makes Postgres refuse the second
 * of two overlapping imports rather than let both commit (P2034), and it
 * comes back as a sentence to confirm again — which then finds everything
 * already there and creates nothing.
 */

export const IMPORT_TX_OPTIONS = { isolationLevel: "Serializable" as const, timeout: 20_000 };

export const IMPORT_COLLIDED =
  "Another import for your company was saving at the same moment, so nothing from this one was saved. Check the preview and confirm again — anything the other import added will show as already there.";

export function isWriteConflict(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2034";
}
