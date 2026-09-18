import type { Walkthrough } from "./types";

/** /jobs/new — the form that starts every job and every estimate. */
export const newJobWalkthrough: Walkthrough = {
  route: "/jobs/new",
  title: "Starting a job",
  steps: [
    {
      anchor: "new-job-name",
      title: "Name the job",
      body:
        "Something you will recognise in a list, like “Smith kitchen remodel” or “Building C, level 3”.",
    },
    {
      anchor: "new-job-scope",
      title: "What the work is",
      body:
        "A sentence or two about what you are doing on this job. You can leave it for now — it can be used later to draft your price lines.",
    },
    {
      anchor: "new-job-client",
      title: "Who it is for",
      body:
        "Pick the contractor or client from the list. If they are not in it yet, press “+ Add a new GC” and type their name.",
    },
    {
      anchor: "new-job-create",
      title: "Create it",
      body:
        "Press Create job. It starts as an estimate, and you land on the job's page to add prices.",
    },
  ],
};
