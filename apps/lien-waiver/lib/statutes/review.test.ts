import { describe, expect, it } from "vitest";
import { REVIEWS, isPublished, reviewDigest, reviewStatus, type LegalReview } from "./review";
import { STATES } from "./types";

describe("the legal-review gate", () => {
  it("hides every unreviewed state in production and shows it everywhere else", () => {
    for (const state of STATES) {
      if (REVIEWS[state]) continue;
      expect(isPublished(state, { VERCEL_ENV: "production" }), state).toBe(false);
      expect(isPublished(state, { VERCEL_ENV: "preview" }), state).toBe(true);
      expect(isPublished(state, {}), state).toBe(true);
    }
  });

  it("publishes a state whose review matches its current text", () => {
    const review: LegalReview = { reviewer: "A. Lawyer", credentials: "AZ Bar 000000", reviewedOn: "2026-10-20", digest: reviewDigest("AZ") };
    expect(isPublished("AZ", { VERCEL_ENV: "production" }, { AZ: review })).toBe(true);
  });

  it("un-publishes a state the moment its text or copy changes after review", () => {
    const stale: LegalReview = { reviewer: "A. Lawyer", credentials: "x", reviewedOn: "2026-10-20", digest: "0".repeat(64) };
    expect(reviewStatus("AZ", { AZ: stale })).toMatchObject({ reviewed: false, reason: "changed-since-review" });
    expect(isPublished("AZ", { VERCEL_ENV: "production" }, { AZ: stale })).toBe(false);
  });

  it("every recorded review still matches what it reviewed", () => {
    for (const [state, review] of Object.entries(REVIEWS)) {
      expect(review!.digest, `${state}'s review no longer matches its text: re-review it`).toBe(reviewDigest(state as never));
    }
  });

  it("gives each state its own digest", () => {
    expect(new Set(STATES.map(reviewDigest)).size).toBe(STATES.length);
  });
});
