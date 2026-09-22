import type { Walkthrough } from "./types";

/**
 * /jobs/[id]/field-reports — the daily site log. Split out of the single
 * `jobDetailWalkthrough` on 2026-09-20; see `job-detail.ts`'s doc
 * comment for why. Named `job-detail-field-reports` rather than
 * `field-reports` to avoid colliding with the top-level `/field-reports`
 * page's own walkthrough file.
 */
export const jobDetailFieldReportsWalkthrough: Walkthrough = {
  route: "/jobs/[id]/field-reports",
  title: "A job — field reports",
  steps: [
    {
      anchor: "job-field-reports",
      title: "A note for each day",
      body:
        "Press Log a day to write what happened on site: who was there, what got done, the weather, and anything that held you up. It is your record if there is ever an argument about the job.",
    },
  ],
};
