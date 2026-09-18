import type { Walkthrough } from "./types";

/** /drawings — which revision of each set is current, and whether you have it. */
export const drawingsWalkthrough: Walkthrough = {
  route: "/drawings",
  title: "Drawings",
  steps: [
    {
      anchor: "drawings-add",
      title: "Add a drawing set",
      body:
        "Press Add a drawing set, pick the job and name the set — like “Architectural” or “Structural”. With no jobs yet, this box has a Go to Jobs button instead.",
    },
    {
      anchor: "drawings-job-filter",
      title: "One job at a time",
      body: "Tap a job to see only its drawing sets. All jobs shows every one.",
    },
    {
      anchor: "drawings-empty",
      title: "No sets yet",
      body:
        "Add one set for each kind of drawing the job sends out separately. The list of revisions then shows which drawings the crew should be building from.",
    },
    {
      anchor: "drawings-list",
      title: "Keep each set current",
      body:
        "When a new revision is sent out, press Record an issue on its set. Anything marked NOT RECEIVED means the crew may be working from old drawings — press Mark received once it is in hand.",
    },
    {
      anchor: "procore-feed",
      title: "The GC's current drawings",
      body:
        "If your GC runs the job in Procore, their current drawings show here once the owner links the project. Only the current revision of each sheet is shown.",
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
        "C Stream only reads these. Press Open in Procore to see the sheet there.",
    },
  ],
};
