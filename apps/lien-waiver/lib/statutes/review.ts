import { createHash } from "node:crypto";
import { STATE_CONTENT } from "@/lib/content";
import { NORMALIZATION_LIST_VERSION } from "./normalization";
import { formsFor } from "./forms";
import type { StateCode } from "./types";

/**
 * THE LEGAL-REVIEW GATE. A state is hidden in production until a
 * construction attorney has reviewed it, and the review is bound to the
 * exact text reviewed.
 *
 * A review records a DIGEST of everything the attorney was shown for that
 * state: the four forms' derived text, the normalization list version, and
 * our plain-English copy and rules for the state. Change any of it --
 * recapture a statute that was amended, reword a meaning -- and the digest
 * moves, the review stops matching, and the state drops out of production
 * on the next deploy until it is reviewed again. An approval cannot
 * survive an edit, which is the only kind of approval worth recording.
 *
 * Record a review by adding an entry below with the digest printed in the
 * attorney packet for that state (docs/lien-waiver/attorney-packet.md). The
 * test in review.test.ts fails if a recorded digest does not match.
 */

export interface LegalReview {
  reviewer: string;
  /** Bar number or firm, as the reviewer wants it recorded. */
  credentials: string;
  /** YYYY-MM-DD, entered -- the date of the review, not of the commit. */
  reviewedOn: string;
  /** reviewDigest(state) at the time of the review. */
  digest: string;
  notes?: string;
}

/** EMPTY ON PURPOSE. No state has been reviewed yet, so none is shown in
 * production. Diego records each review here as the attorney signs off. */
export const REVIEWS: Partial<Record<StateCode, LegalReview>> = {};

export function reviewDigest(state: StateCode): string {
  const hash = createHash("sha256");
  hash.update(`normalization:${NORMALIZATION_LIST_VERSION}\n`);
  for (const form of formsFor(state)) hash.update(`${form.form}:${form.textSha256}\n`);
  hash.update(`content:${JSON.stringify(STATE_CONTENT[state])}\n`);
  return hash.digest("hex");
}

export type ReviewStatus =
  | { reviewed: true; review: LegalReview }
  | { reviewed: false; reason: "never-reviewed" | "changed-since-review"; review?: LegalReview };

export function reviewStatus(state: StateCode, reviews: Partial<Record<StateCode, LegalReview>> = REVIEWS): ReviewStatus {
  const review = reviews[state];
  if (!review) return { reviewed: false, reason: "never-reviewed" };
  if (review.digest !== reviewDigest(state)) return { reviewed: false, reason: "changed-since-review", review };
  return { reviewed: true, review };
}

/** Production is Vercel's production environment and nothing else. A
 * preview, a laptop and CI all show every state, watermarked. */
export function isProduction(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

export function isPublished(
  state: StateCode,
  env: Record<string, string | undefined> = process.env,
  reviews: Partial<Record<StateCode, LegalReview>> = REVIEWS,
): boolean {
  return !isProduction(env) || reviewStatus(state, reviews).reviewed;
}
