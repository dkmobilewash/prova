/**
 * What a review source file is. Client-safe on purpose — the run panel renders
 * these labels in the browser — and mirrored by the Prisma enum
 * `SubcontractReviewSourceRole`, which `subcontractCategoryCensus.test.ts`
 * holds equal to this list.
 */

export const SOURCE_ROLES = [
  "AGREEMENT",
  "SCOPE_EXHIBIT",
  "INSURANCE_EXHIBIT",
  "GENERAL_CONDITIONS",
  "DRAWINGS_LIST",
  "OTHER_EXHIBIT",
] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];

export const SOURCE_ROLE_LABEL: Record<SourceRole, string> = {
  AGREEMENT: "Subcontract agreement",
  SCOPE_EXHIBIT: "Scope of work exhibit",
  INSURANCE_EXHIBIT: "Insurance requirements exhibit",
  GENERAL_CONDITIONS: "General conditions",
  DRAWINGS_LIST: "Drawings and specifications list",
  OTHER_EXHIBIT: "Other exhibit",
};

/** An exhibit is everything but the agreement — the agreement is always the
 *  contract version's own file and is never uploaded through this path. */
export const EXHIBIT_ROLES = SOURCE_ROLES.filter((role) => role !== "AGREEMENT");
