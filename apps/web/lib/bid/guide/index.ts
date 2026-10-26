import type { JobGuide } from "./types";

/**
 * PLACEHOLDER — NOT THE ENGINE. The real `getOpenJobGuides` / `getJobGuide`
 * (facts loader + `buildJobGuide`) is built on another branch and REPLACES
 * THIS FILE at merge. The two signatures below are the contract the home screen
 * (`app/bid/(signed-in)/home/page.tsx`) is written against; keep them exactly.
 *
 * Until then the home shows its empty state: no guides, no invented ones.
 */

/** Every open (ESTIMATE-status) job's guide for the company, soonest due first. */
export async function getOpenJobGuides(companyId: string): Promise<JobGuide[]> {
  void companyId;
  return [];
}

/** One job's guide, or null when the job is not this company's / not open. */
export async function getJobGuide(companyId: string, jobId: string): Promise<JobGuide | null> {
  void companyId;
  void jobId;
  return null;
}
