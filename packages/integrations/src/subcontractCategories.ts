/**
 * The subcontract-review vocabulary, in a file that imports NOTHING — so the
 * review page's client components can read the categories without pulling the
 * Anthropic SDK into the browser bundle. `subcontractReview.ts` re-exports it.
 */

/**
 * THE canonical category list. The Prisma enum `SubcontractFindingCategory`
 * mirrors it and `subcontractCategoryCensus.test.ts` requires the two to be
 * equal — and that no second hand-written copy exists in the app, which is the
 * #526 lesson: a completeness test on the shared list cannot see a consumer that
 * stopped reading it.
 */
export const SUBCONTRACT_FINDING_CATEGORIES = [
  "PAYMENT",
  "RETAINAGE",
  "BILLING",
  "LIQUIDATED_DAMAGES",
  "INDEMNITY",
  "DELAY_AND_SCHEDULE",
  "NOTICE",
  "TERMINATION",
  "BACKCHARGE",
  "WARRANTY",
  "INSURANCE",
  "BONDING",
  "LIEN_WAIVER",
  "FLOW_DOWN",
  "DISPUTE",
  "SAFETY_SITE_ADMIN",
  "SCOPE",
  "OTHER",
] as const;

export type SubcontractFindingCategory = (typeof SUBCONTRACT_FINDING_CATEGORIES)[number];

export const SUBCONTRACT_SEVERITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type SubcontractSeverity = (typeof SUBCONTRACT_SEVERITIES)[number];
