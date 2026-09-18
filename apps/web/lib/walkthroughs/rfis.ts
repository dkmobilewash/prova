import type { Walkthrough } from "./types";

/** /rfis — questions to the GC or architect, and what came back. */
export const rfisWalkthrough: Walkthrough = {
  route: "/rfis",
  title: "RFIs",
  steps: [
    {
      anchor: "rfis-raise",
      title: "Ask a question",
      body:
        "Press Raise an RFI, pick the job, and type the question with the drawing or spec it is about. With no jobs yet, this box has a Go to Jobs button instead — an RFI always belongs to a job.",
    },
    {
      anchor: "rfis-job-filter",
      title: "One job at a time",
      body: "Tap a job to see only its RFIs. All jobs shows every one.",
    },
    {
      anchor: "rfis-show-closed",
      title: "Closed ones",
      body: "Closed RFIs are hidden so the list shows what is still in play. Press Show closed to see them too.",
    },
    {
      anchor: "rfis-empty",
      title: "Nothing asked yet",
      body:
        "Raise one the day the question comes up. The dates it was sent and answered are your proof if a late answer holds up the job.",
    },
    {
      anchor: "rfis-list",
      title: "Move each one along",
      body:
        "Press Mark sent when it goes out, then Record answer when the answer comes back. Once it is dealt with, press Close.",
    },
  ],
};
