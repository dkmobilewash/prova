import type { Walkthrough } from "./types";

/** /bids — every bid invitation, and what it went for. */
export const bidsWalkthrough: Walkthrough = {
  route: "/bids",
  title: "Bid history",
  steps: [
    {
      anchor: "bids-empty",
      title: "Where bids come from",
      body:
        "Bids are not added on this page. Open Contacts, pick the contractor who asked you to price the job, and log it under Bid invitations — it then shows up here.",
    },
    {
      anchor: "bids-filter",
      title: "Find similar work",
      body:
        "Pick a trade, a status like Won or Lost, or both, then press Filter. Clear puts the full list back.",
    },
    {
      anchor: "bids-list",
      title: "Every bid you were asked for",
      body:
        "Each line shows the project, the contractor, whether you won, and the price you bid. Tap a line to open that contractor's page.",
    },
  ],
};
