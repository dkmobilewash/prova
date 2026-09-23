import type { Walkthrough } from "./types";

/**
 * /jobs/[id]/crew — field time entries, timesheet sign-off, T&M tickets
 * and union dispatch. Split out of the single `jobDetailWalkthrough` on
 * 2026-09-20; see `job-detail.ts`'s doc comment for why.
 */
export const jobDetailCrewWalkthrough: Walkthrough = {
  route: "/jobs/[id]/crew",
  title: "A job — crew & time",
  steps: [
    {
      anchor: "job-time",
      title: "Hours worked",
      body:
        "Record who worked, which day and how many hours, then press Log time. Your crew can also clock in and out from the C Stream phone app, and those hours show up here too.",
    },
  ],
};
