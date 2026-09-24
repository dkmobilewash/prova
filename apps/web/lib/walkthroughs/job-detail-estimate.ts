import type { Walkthrough } from "./types";

/**
 * /jobs/[id]/estimate — pricing and job costing. Split out of the single
 * `jobDetailWalkthrough` on 2026-09-20; see `job-detail.ts`'s doc comment
 * for why. Its own file rather than a name clash with the top-level
 * `/catalog` or `/phase-codes` walkthroughs.
 */
export const jobDetailEstimateWalkthrough: Walkthrough = {
  route: "/jobs/[id]/estimate",
  title: "A job — estimate",
  steps: [
    {
      anchor: "job-wall-schedule",
      title: "Enter the walls",
      body:
        "Add each run of wall by its type, length and height — the tag from the drawings, like W1. The studs, track and board are worked out and added to the lines below, and change when you change a run.",
    },
    {
      anchor: "job-line-items",
      title: "Price the job",
      body:
        "These are the lines of your estimate. Describe the work in the box and press Draft line items to have them written for you, or use Add from a takeoff if you have measurements. Check every line — you can change any of them.",
    },
    {
      anchor: "job-add-line-item",
      title: "Add a line yourself",
      body:
        "Type what it is, how many, the unit and the price, then press Add line item. If you have saved prices in your catalog, you can pick one under Add from catalog.",
    },
    {
      anchor: "job-lock-in",
      title: "Lock the price in",
      body:
        "Once the contract is signed, press Mark as contracted here. After that, any change to the price goes through a change order, so there is a record of it.",
    },
    {
      anchor: "job-change-orders",
      title: "Changes after signing",
      body:
        "When the client asks for extra work once the job is contracted, give it a name under New change order and add what changes. It only moves the price once they agree to it.",
    },
  ],
};
