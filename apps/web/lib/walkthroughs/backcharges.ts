import type { Walkthrough } from "./types";

/** /backcharges — money a contractor is taking off what they owe you. */
export const backchargesWalkthrough: Walkthrough = {
  route: "/backcharges",
  title: "Backcharges",
  steps: [
    {
      anchor: "backcharges-log",
      title: "Log one the day it arrives",
      body:
        "A backcharge is money the contractor takes off your pay — for cleanup, damage, or work somebody else finished. Press Log a backcharge and fill it in. With no jobs yet, this box has a Go to Jobs button instead.",
    },
    {
      anchor: "backcharges-totals",
      title: "The totals",
      body:
        "How much is claimed and still open, how many are past the date to object, what settled ones cost you, and what you got taken off. These are a record only — they do not change any invoice.",
    },
    {
      anchor: "backcharges-job-filter",
      title: "One job at a time",
      body: "Tap a job to see only its backcharges. All jobs shows every one.",
    },
    {
      anchor: "backcharges-empty",
      title: "Nothing open",
      body:
        "No backcharges are waiting on you. Press Show resolved to see the ones already closed out.",
    },
    {
      anchor: "backcharges-list",
      title: "Answer each one",
      body:
        "Press Object to write down that you disagree, with the date you told them. Press Close out once it is settled, accepted or withdrawn.",
    },
  ],
};
