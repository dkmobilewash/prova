import type { Walkthrough } from "./types";

/** /phase-codes — budget against actual for each of your own cost codes. */
export const phaseCodesWalkthrough: Walkthrough = {
  route: "/phase-codes",
  title: "Phase codes",
  steps: [
    {
      anchor: "phase-codes-empty",
      title: "What a phase code is",
      body:
        "Your own name for a bucket of work, like 04112 for Plywood. Once your line items carry one, this page adds up what you budgeted against what it really cost, across every job.",
    },
    {
      anchor: "phase-codes-set-up",
      title: "Make your first one",
      body:
        "Press Set up your first phase code. It takes you to Settings, where you type the number and the name the way your estimates already write them.",
    },
    {
      anchor: "phase-codes-coverage",
      title: "How much is coded",
      body:
        "How much of your budget, and of what you have spent, has a phase code on it. Anything without one is not lost — it sits in the Not coded to a phase row at the bottom.",
    },
    {
      anchor: "phase-codes-table",
      title: "Budget against actual",
      body:
        "One line per code, totalled across all your jobs. Variance says how far over or under budget that phase is — red is over, green is under.",
    },
  ],
};
