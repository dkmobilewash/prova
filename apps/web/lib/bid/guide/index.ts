import type { JobGuide } from "./types";

/**
 * PLACEHOLDER — NOT THE ENGINE. The real `getJobGuide` / `getOpenJobGuides`
 * (`buildJobGuide` over `loadJobGuideFacts`) are built on another branch and
 * REPLACE THIS FILE WHOLESALE when the branches merge. The signatures below
 * are the contract and must not change. Until then a null guide makes the job
 * layout fall back to its plain tabs, which is exactly what it did before the
 * guided screen existed.
 */
export async function getJobGuide(companyId: string, jobId: string): Promise<JobGuide | null> {
  void companyId;
  void jobId;
  return null;
}

export async function getOpenJobGuides(companyId: string): Promise<JobGuide[]> {
  void companyId;
  return [];
}
