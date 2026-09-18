import type { Walkthrough } from "./types";

/** /field-reports — one short note per job per day, across every job. */
export const fieldReportsWalkthrough: Walkthrough = {
  route: "/field-reports",
  title: "Daily reports",
  steps: [
    {
      anchor: "field-reports-no-jobs",
      title: "Add a job first",
      body:
        "A daily report is about a job, so you need one first. Press Create a job, then come back here.",
    },
    {
      anchor: "field-reports-log-day",
      title: "Write today's report",
      body:
        "Press Log a day. Pick the job and the day, then say who was on site, what got done, the weather, and anything that held you up. Press Save report.",
    },
    {
      anchor: "field-reports-form",
      title: "Fill it in",
      body:
        "The date is the day the work happened, not the day you are typing. The weather and delays boxes are the ones that matter most if there is ever an argument about the job later. Press Save report when done.",
    },
    {
      anchor: "field-reports-job-filter",
      title: "One job at a time",
      body: "Tap a job to see only its reports — handy when a client asks what happened on their job.",
    },
    {
      anchor: "field-reports-empty",
      title: "Nothing written yet",
      body: "Your reports will show up here, grouped by week, once you save the first one.",
    },
    {
      anchor: "field-reports-weeks",
      title: "Your reports, week by week",
      body:
        "Each week lists its reports, newest first. A yellow note names any past weekday with no report, so you can catch up while you still remember it.",
    },
  ],
};
