import type { Walkthrough } from "./types";

/** /union-compliance — fringe owed to the trust funds, and the apprentice ratio. */
export const unionComplianceWalkthrough: Walkthrough = {
  route: "/union-compliance",
  title: "Union fringe and apprentices",
  steps: [
    {
      anchor: "uc-month",
      title: "Pick the month",
      body:
        "Everything on this page is worked out from the hours your crew logged in this month. Use the arrows to go back or forward a month.",
    },
    {
      anchor: "uc-remittance",
      title: "What you owe the funds",
      body:
        "Pension, vacation, health and welfare, and training owed for the month, for each local and each classification. Hours marked unpriced have no craft or no rate yet, so the total is short by those.",
    },
    {
      anchor: "uc-ratio",
      title: "Apprentice ratio",
      body:
        "Each job, day by day: journeyman hours against apprentice hours. A day over the ratio is flagged, and a day the page cannot judge says so instead of passing it.",
    },
    {
      anchor: "uc-apprenticeships",
      title: "Apprentice records",
      body:
        "Press Register an apprenticeship to record an apprentice's sponsor, program number and classroom hours. Their on-the-job hours come from the timesheets.",
    },
    {
      anchor: "uc-worker-crafts",
      title: "Who works as what",
      body:
        "Tick the crafts each person works under, so their phone only offers those when they log hours. Leave a person with none ticked and they see every craft.",
    },
    {
      anchor: "uc-setup",
      title: "Start here: your locals and rates",
      body:
        "Press Add a local you work under, then add its classifications and their fringe rates. Everything above is worked out from what you put here.",
    },
  ],
};
