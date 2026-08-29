/**
 * Types for connection-target.mjs.
 *
 * The implementation is plain .mjs so the Vercel build and the CI workflow
 * can run it with bare `node`, before any TypeScript build step exists.
 * These declarations exist so the tests in apps/web/lib/db-target.test.ts
 * typecheck against it rather than importing an implicit `any`.
 */

export type ConnectionTarget = {
  host: string;
  database: string | null;
  pooled: boolean;
  endpointId: string | null;
  /** Host and database name only — safe to print. Never a credential. */
  label: string;
};

export type ConnectionProblem = {
  level: "fatal" | "warning";
  message: string;
};

export function neonEndpointId(host: string): string | null;
export function isPooled(host: string): boolean;
export function describe(connectionString: string | undefined | null): ConnectionTarget | null;
export function sameDatabase(
  a: ConnectionTarget | null,
  b: ConnectionTarget | null,
): boolean;
export function connectionProblems(
  databaseUrl: string | undefined | null,
  directUrl: string | undefined | null,
): {
  app: ConnectionTarget | null;
  migrate: ConnectionTarget | null;
  problems: ConnectionProblem[];
};
