import type { Walkthrough } from "./types";

/** /proposals — the standard clauses a sub pulls into every bid proposal. */
export const proposalsWalkthrough: Walkthrough = {
  route: "/proposals",
  title: "Proposal clauses",
  steps: [
    {
      anchor: "proposals-empty",
      title: "What goes here",
      body:
        "The lines you type on every bid: what is included, what is excluded, what your price assumes, and alternates the contractor can add. Write each one once here.",
    },
    {
      anchor: "proposals-list",
      title: "Your standard set",
      body:
        "Change the wording or the kind and press Save. Changing a clause here does not change a proposal you have already added it to — that proposal keeps its own copy.",
    },
    {
      anchor: "proposals-add",
      title: "Add a clause",
      body:
        "Pick what kind it is, type it the way you would write it on a bid, and press Add clause. Then open a job's Estimate tab and choose Proposal & exclusions to put it on that bid.",
    },
  ],
};
