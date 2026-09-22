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
        "Pick the contractor or client from the list. If they are not in it yet, press “+ Add a new GC” and type their name. With no GCs on your account yet, this box has no list to pick from — it shows “No GCs on your account yet — this one will be the first” instead.",
    },
    {
      anchor: "new-job-create",
      title: "Start it",
      // THIS STEP NAMED A BUTTON THAT DOES NOT EXIST AND A DESTINATION IT
      // DOES NOT GO TO. It said "Press Create job… you land on the job's
      // page to add prices". There has never been a button reading "Create
      // job" on this form, and pressing the one that is there goes to the
      // second screen of the two-step bid wizard, not to the job page. A
      // tour that mis-names the control it is pointing at is worse than no
      // tour: it teaches the reader that the help is guessing, and this
      // reader has no other way to check.
      body:
        "Press “Start the job — add the work next”. It starts as an estimate, and the next screen is where you put the work on it. Nothing is lost if you stop there — the job is already in your list.",
    },
  ],
};
