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

/** Recorded 2026-10-12 from Diego's report of each attorney's sign-off. Each
 * digest matched the one printed for that state in docs/attorney-packet.md
 * when it was recorded. Texas has no review yet, so production still hides
 * it. New Mexico was reviewed too (David N. Hernandez, 2026-10-12), but it
 * has no statutory form, so there is no digest to record here; its page is
 * public regardless. */
export const REVIEWS: Partial<Record<StateCode, LegalReview>> = {
  AZ: {
    reviewer: "Patrick J. Monahan",
    credentials: "Not provided",
    reviewedOn: "2026-10-12",
    digest: "77a3323fbd65936d8bd87a8fc1579d3959045c95e41b3e07f2de0d4be83c192c",
    notes: "Sign-off reported by Diego Carrillo on 2026-10-12.",
  },
  CA: {
    reviewer: "Jeffrey D. Horowitz",
    credentials: "Not provided",
    reviewedOn: "2026-10-12",
    digest: "77605a5d4d193080a9b99d6ec63203494065f5706622e9a895f45d596a29c546",
    notes: "Sign-off reported by Diego Carrillo on 2026-10-12.",
  },
  NV: {
    reviewer: "M. Dason Coronado",
    credentials: "Not provided",
    reviewedOn: "2026-10-12",
    digest: "e380b072c6d948f03ff28b5c4d5aee978784b71c910f2cf160171fa21439ec26",
    notes: "Sign-off reported by Diego Carrillo on 2026-10-12.",
  },
};

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
