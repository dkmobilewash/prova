import type { Walkthrough } from "./types";

/** /vendors — the suppliers and rental yards you buy from. */
export const vendorsWalkthrough: Walkthrough = {
  route: "/vendors",
  title: "Your vendors",
  steps: [
    {
      anchor: "vendors-add",
      title: "Add a supplier",
      body:
        "Press Add a vendor and type the supplier's name, what they sell you, and who you talk to there. Only the name is needed.",
    },
    {
      anchor: "vendors-empty",
      title: "No vendors yet",
      body:
        "Start with the ones you buy from most — board and steel, scaffolding, equipment rental.",
    },
    {
      anchor: "vendors-coi",
      title: "Their insurance",
      body:
        "Each vendor shows whether their certificate of insurance is current, running out or expired. Red means don't put them on site until a new one is in.",
    },
    {
      anchor: "vendors-list",
      title: "Your directory",
      body: "Every vendor, A to Z, with their phone and email. Press Edit on a line to change it.",
    },
    {
      anchor: "vendors-pricing-link",
      title: "Their prices",
      body: "What each vendor has quoted you, and whether prices are going up, is on the vendor pricing page. Tap this link to go there.",
    },
  ],
};
