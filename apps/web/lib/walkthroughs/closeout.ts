import type { Walkthrough } from "./types";

/** /closeout — what is owed before final payment, and the warranty after. */
export const closeoutWalkthrough: Walkthrough = {
  route: "/closeout",
  title: "Closeout and warranty",
  steps: [
    {
      anchor: "closeout-empty",
      title: "Start with a job",
      body:
        "Closeout and warranty both belong to a job, so this page is empty until you have one. Press Create a job to add your first.",
    },
    {
      anchor: "closeout-next",
      title: "What to do next",
      body:
        "The jobs still holding up final payment, the most money first, with what is missing on each. A job leaves this list once the contractor has accepted its paperwork.",
    },
    {
      anchor: "closeout-jobs",
      title: "One card per job",
      body:
        "Each job has its paperwork, its checklist, its warranty and its callbacks. Tap the job name to open the job itself.",
    },
    {
      anchor: "closeout-package",
      title: "Sending the paperwork",
      body:
        "Press Record the package going out on the day you send the closeout paperwork. When the contractor answers, write down whether they accepted it or sent it back.",
    },
    {
      anchor: "closeout-checklist",
      title: "What they want before paying",
      body:
        "Lien waivers, as-built drawings, manuals, warranty letters. Press Add the standard checklist to start with the usual list, or Add an item for your own.",
    },
    {
      anchor: "closeout-warranty",
      title: "The warranty clock",
      body:
        "Press Set the warranty period with the start date and how long it lasts. The card then shows how many days are left.",
    },
    {
      anchor: "closeout-callbacks",
      title: "Callbacks",
      body:
        "When you are called back to fix something after the job is done, press Record a callback. It tells you whether it came in under warranty.",
    },
  ],
};
