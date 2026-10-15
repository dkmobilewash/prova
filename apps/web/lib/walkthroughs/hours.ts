import type { Walkthrough } from "./types";

/** /hours — everyone's hours for one week, across every job. */
export const hoursWalkthrough: Walkthrough = {
  route: "/hours",
  title: "The week's hours",
  steps: [
    {
      anchor: "hours-week",
      title: "Pick the week",
      body: "Monday to Sunday. Step back or forward a week; This week brings you back to today.",
    },
    {
      anchor: "hours-grid",
      title: "Everyone's week",
      body:
        "One row per person, one column per day, with their total on the right and each day's total along the bottom. Fix an hour on the job's Crew & time tab.",
    },
    {
      anchor: "hours-by-job",
      title: "Hours by job",
      body: "The same week split by job, biggest first. Each job opens its Crew & time tab.",
    },
    {
      anchor: "hours-empty",
      title: "Nothing logged yet",
      body: "Hours show up here as the crew logs them on the phone, or as you add them on a job.",
    },
  ],
};
