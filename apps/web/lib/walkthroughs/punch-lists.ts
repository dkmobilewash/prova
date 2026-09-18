import type { Walkthrough } from "./types";

/** /punch-lists — what still has to be fixed before a job is done. */
export const punchListsWalkthrough: Walkthrough = {
  route: "/punch-lists",
  title: "Punch lists",
  steps: [
    {
      anchor: "punch-add",
      title: "Write down what needs fixing",
      body:
        "Pick the job, type what needs fixing — like “touch-up paint, hallway” — and press Add item, one item at a time as you walk the job. With no jobs yet, this box has a Create a job button instead.",
    },
    {
      anchor: "punch-job-filter",
      title: "One job at a time",
      body: "Tap a job to see only its list. All jobs shows everything that is still open.",
    },
    {
      anchor: "punch-open",
      title: "What is still open",
      body:
        "The count of items not fixed yet. Tick the box on an item once it is done — it drops off the list. Show completed brings the finished ones back.",
    },
  ],
};
