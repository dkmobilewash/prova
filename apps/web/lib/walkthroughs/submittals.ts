import type { Walkthrough } from "./types";

/** /submittals — shop drawings and product data sent for approval, and what came back. */
export const submittalsWalkthrough: Walkthrough = {
  route: "/submittals",
  title: "Submittals",
  steps: [
    {
      anchor: "submittals-log",
      title: "Log a package",
      body:
        "Press Log a submittal the day you send shop drawings or product data for approval. With no jobs yet, this box has a Go to Jobs button instead — a submittal always belongs to a job.",
    },
    {
      anchor: "submittals-job-filter",
      title: "One job at a time",
      body: "Tap a job to see only its submittals. All jobs shows every one.",
    },
    {
      anchor: "submittals-show-approved",
      title: "Approved ones",
      body: "Approved submittals are hidden so the list shows what is still moving. Press Show approved to see them too.",
    },
    {
      anchor: "submittals-empty",
      title: "Nothing sent yet",
      body:
        "Log each package the day it goes out. The dates it was sent and came back are your proof if a slow approval holds up the job.",
    },
    {
      anchor: "submittals-list",
      title: "Track what came back",
      body:
        "Press Record response when the GC sends it back. If they want changes, press Send revision to log the next version, so you always know which one is safe to build from.",
    },
    {
      anchor: "procore-feed",
      title: "The GC's submittals from Procore",
      body:
        "If your GC runs the job in Procore, their submittals show here once the owner links the project. They are the GC's records, not part of your log.",
    },
    {
      anchor: "procore-refresh",
      title: "Get the latest from Procore",
      body:
        "This refreshes by itself when the page opens. Press Refresh from Procore to read it again now.",
    },
    {
      anchor: "procore-feed-list",
      title: "Open it in Procore",
      body:
        "C Stream only reads these. Press Open in Procore to answer or change one there.",
    },
  ],
};
