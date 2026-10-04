/**
 * Types for company-target.mjs.
 *
 * The implementation is plain .mjs because the seed script runs under bare
 * `node` in a workflow with no TypeScript build step. These declarations
 * exist so apps/web/lib/seed-company-target.test.ts typechecks against it
 * rather than importing an implicit `any` — same arrangement as
 * connection-target.d.mts.
 */

export type CompanyRow = {
  id: string;
  name: string;
};

export type CompanyTargetRequest =
  | { by: "id"; id: string }
  | { by: "name"; name: string }
  | { by: "conflict"; id: string; name: string }
  | { by: "oldest" };

export type CompanyTargetResolution =
  | { company: CompanyRow; lines: string[]; error?: undefined }
  | { company?: undefined; lines?: undefined; error: string[] };

/** The comparison key: case-folded, whitespace- and apostrophe-normalised. */
export function companyNameKey(name: string | null | undefined): string;

export function companyTargetRequest(env?: {
  SEED_COMPANY_ID?: string;
  SEED_COMPANY_NAME?: string;
}): CompanyTargetRequest;

export function resolveCompanyTarget<T extends CompanyRow>(
  request: CompanyTargetRequest,
  candidates: (T | null | undefined)[],
): { company: T; lines: string[]; error?: undefined } | { company?: undefined; lines?: undefined; error: string[] };
