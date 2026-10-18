import type { Walkthrough } from "./types";

/** /wip — how each job is really doing, all on one page. */
export const wipWalkthrough: Walkthrough = {
  route: "/wip",
  title: "Work in progress",
  steps: [
    {
      anchor: "wip-empty",
      title: "Nothing to report yet",
      body:
        "A job shows up here once it is contracted. An estimate has not earned anything yet, so there would be nothing to say about it.",
    },
    {
      anchor: "wip-table",
      title: "Every job, side by side",
      body:
        "One row per job: what it is worth, how far along it is, how much of it you have earned, and how much you have billed. The last row adds them all up. Press Show the cost breakdown for the cost, profit and coverage columns — the job name stays put while the wider table slides sideways.",
    },
    {
      anchor: "wip-billing",
      title: "Ahead or behind on billing",
      body:
        "Point at a heading for what it means. Overbilled is billing more than you have earned, so some of that money is not yours yet; underbilled is work done you have not charged for. Both are normal, and a big one is worth a look.",
    },
    {
      anchor: "wip-coverage",
      title: "Why some cells have a dash",
      body:
        "A dash is not a zero. It means too little of that job has been estimated for the figure to mean anything, so the page says nothing instead of guessing. The coverage columns in the cost breakdown tell you how much of the job is covered.",
    },
    {
      anchor: "wip-download",
      title: "The copy you hand over",
      body:
        "A bonding company, a bank or your accountant will ask for this. The download is the same figures as a spreadsheet, with a heading that says what it covers and how it was worked out.",
    },
  ],
};
