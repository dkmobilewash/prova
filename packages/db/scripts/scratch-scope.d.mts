/**
 * Types for scratch-scope.mjs.
 *
 * The implementation is plain .mjs because clean-test-jobs.mjs runs under
 * bare `node`, with no build step. These declarations exist so
 * apps/web/lib/scratch-scope.test.ts typechecks against it rather than
 * importing an implicit `any` — which matters more here than usual: the
 * thing being tested decides what a delete against real data touches, and
 * a test that silently types as `any` is a test that stops catching a
 * renamed export.
 */

export type BlockingTable = {
  /** Prisma model name holding rows the cleanup will not delete. */
  model: string;
  rows: number;
  /** Why it blocks: protected evidence, or simply unknown to the script. */
  reason: string;
};

/** Job-owned models the cleanup deletes, in foreign-key order. */
export const HANDLED_MODELS: string[];

/** Models never deleted by a cleanup, even carrying a jobId. */
export const NEVER_DELETE: string[];

export function delegateName(model: string): string;

export function blockingTables(
  counts: Record<string, number>,
  handled?: string[],
  never?: string[],
): BlockingTable[];

export function jobNamesFrom(argv: string[], fallback?: string[]): string[];
