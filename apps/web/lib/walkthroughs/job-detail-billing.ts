import type { Walkthrough } from "./types";

/**
 * /jobs/[id]/billing — invoices and pay applications. Split out of the
 * single `jobDetailWalkthrough` on 2026-09-20; see `job-detail.ts`'s doc
 * comment for why.
 */
export const jobDetailBillingWalkthrough: Walkthrough = {
  route: "/jobs/[id]/billing",
  title: "A job — billing",
  steps: [
    {
      anchor: "job-invoices",
      title: "Bill the job",
      body: "Press Create invoice to bill the job. When the client pays, use Log payment on that invoice so you always know what is still owed.",
    },
  ],
};
