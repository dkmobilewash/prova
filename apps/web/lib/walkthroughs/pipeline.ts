import type { Walkthrough } from "./types";

/** /pipeline — work you are chasing, then the bids you were invited to. */
export const pipelineWalkthrough: Walkthrough = {
  route: "/pipeline",
  title: "Work you are chasing",
  steps: [
    {
      anchor: "pipeline-chase-list",
      title: "Your chase list",
      body:
        "Jobs you have heard about but nobody has asked you to price yet — a house going up, a builder you have been talking to. It only knows what you type in.",
    },
    {
      anchor: "pipeline-add-pursuit",
      title: "Add one",
      body:
        "Press Add a pursuit, type the project name and anything you know about it, then press Add pursuit. Only the project name is needed.",
    },
    {
      anchor: "pipeline-open-pursuits",
      title: "Keep it up to date",
      body:
        "Change the stage menu on a line as things move: watching, contacted, expecting an invite. When you are invited to bid, set it to Invited; if it goes nowhere, set it to Dropped.",
    },
    {
      anchor: "pipeline-no-invitations",
      title: "Invitations to bid",
      body:
        "Once a contractor asks you to price a job, it shows here. Log each invitation on that contractor's page under Contacts.",
    },
    {
      anchor: "pipeline-waiting",
      title: "Waiting on you",
      body:
        "Bids you have been invited to and not finished yet, with the date they asked for. Anything in red is past that date.",
    },
    {
      anchor: "pipeline-by-gc",
      title: "How you do with each contractor",
      body:
        "For each contractor: how often they invite you, how often you bid, and how often you win. Tap a name to see their page.",
    },
  ],
};
