import type { Walkthrough } from "./types";

/** /schedule — who is on which job, day by day, and every job's dates. */
export const scheduleWalkthrough: Walkthrough = {
  route: "/schedule",
  title: "The schedule",
  steps: [
    {
      anchor: "schedule-no-jobs",
      title: "Nothing to schedule yet",
      body:
        "The schedule lays out your jobs and who is on them, so there has to be a job first. Press Create a job to add one, then come back.",
    },
    {
      anchor: "schedule-crew-board",
      title: "Who is working where",
      body:
        "Each day for the next two weeks, and who is planned to be on which job. Nothing fills this in for you — it only shows what you put on it.",
    },
    {
      anchor: "schedule-put-on",
      title: "Put someone on a day",
      body:
        "Press Put someone on, pick the job, the person and the day, then press Put them on. Do it once for each person, each day.",
    },
    {
      anchor: "schedule-missing-hours",
      title: "Days with no hours",
      body:
        "Someone was planned on a job for a day that is over, but no hours were logged for them. Open the job and log the time, so your costs and payroll are right.",
    },
    {
      anchor: "schedule-subscribe",
      title: "Put the schedule on your phone",
      body:
        "Press Create my calendar link, then copy it into your phone's calendar app. Every planned day shows up as an all-day event and updates itself — nobody has to re-send it. Regenerating replaces the link, so every calendar subscribed to the old one stops updating.",
    },
    {
      anchor: "schedule-start-dates",
      title: "When each job runs",
      body:
        "Every job with a start date, earliest first. To give a job its dates, tap it and fill in Start date and End date on the job's page.",
    },
    {
      anchor: "schedule-unscheduled",
      title: "Jobs with no dates",
      body:
        "These jobs have no start date yet, so they are on no week. Tap one to set its dates.",
    },
  ],
};
