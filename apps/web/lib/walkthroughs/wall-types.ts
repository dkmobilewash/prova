import type { Walkthrough } from "./types";

/** /wall-types — the partition schedule every job's wall runs are priced from. */
export const wallTypesWalkthrough: Walkthrough = {
  route: "/wall-types",
  title: "Wall types",
  steps: [
    {
      anchor: "wall-types-empty",
      title: "What goes here",
      body:
        "One entry per wall type on your drawings — W1, W2, P-4A — and what it is built from. Start from the two common types if you like, then change them to match how you build.",
    },
    {
      anchor: "wall-types-list",
      title: "What a foot of wall is made of",
      body:
        "Each part says how it is counted: studs per stud, track per foot of wall, board per square foot boarded. Pick a price book entry to price it and type your crew's rate to get the hours.",
    },
    {
      anchor: "wall-types-add",
      title: "Add a wall type",
      body:
        "Give it the tag from the drawings and say what it is. Then open a job's Estimate tab and enter each run of wall under Wall schedule — the studs, track and board are worked out for you.",
    },
  ],
};
