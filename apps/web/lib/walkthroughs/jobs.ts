import type { Walkthrough } from "./types";

/** /jobs — every job, searchable and filtered by stage (/estimating
 * redirects here with the Estimating filter on). */
export const jobsWalkthrough: Walkthrough = {
  route: "/jobs",
  title: "Your jobs",
  steps: [
    {
      anchor: "jobs-filters",
      title: "Find a job",
      body:
        "Type a job or client name and press Enter. The buttons show jobs at one stage — Estimating is everything you are still pricing.",
    },
    {
      anchor: "jobs-list",
      title: "Every job",
      body:
        "Grouped by where it is: estimating, contracted, in progress, complete. The small tag on an estimate says what it still needs, like “Needs pricing”. Tap a job to open it.",
    },
  ],
};
