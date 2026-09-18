import type { Walkthrough } from "./types";

/** /certifications — the cards your crew has to show at the gate. */
export const certificationsWalkthrough: Walkthrough = {
  route: "/certifications",
  title: "Crew certifications",
  steps: [
    {
      anchor: "certifications-record",
      title: "Write down a card",
      body:
        "Press Record a certification, pick the worker and the card — OSHA 10, scaffold, lift — and put in the date it runs out. With nobody on your team yet, this box has a Go to Team button instead.",
    },
    {
      anchor: "certifications-totals",
      title: "The counts",
      body:
        "How many cards are missing, run out, about to run out, or have no end date written down. Anything above zero is worth sorting before the next dispatch.",
    },
    {
      anchor: "certifications-people",
      title: "Who to sort out",
      body:
        "Only the people with a problem are listed, with what is wrong. Press Show everyone, including current to see the whole crew's cards.",
    },
    {
      anchor: "certifications-by-job",
      title: "Is this job's crew clear",
      body:
        "The same problems, grouped by job, for the people assigned to it. A job with nobody assigned is left out.",
    },
    {
      anchor: "certifications-required",
      title: "What everyone must have",
      body:
        "Press Require a certification to say every worker needs a card, like OSHA 10. Anyone with no record of it then shows up above by name.",
    },
  ],
};
