import type { Walkthrough } from "./types";

/** /intake — drop in a pile of paperwork and sort it one row at a time. */
export const intakeWalkthrough: Walkthrough = {
  route: "/intake",
  title: "Sort your paperwork",
  steps: [
    {
      anchor: "intake-drop",
      title: "Drop the files in",
      body:
        "Drag a folder of paperwork the contractor sent you onto this box, or press Choose a folder or Choose files. Nothing is filed yet — each file just gets a row below.",
    },
    {
      anchor: "intake-forward",
      title: "Or forward it by email",
      body:
        "Your company has its own address for paperwork. Forward any email to it and the attachments land in this tray, marked with who sent them — copy the address into the contacts you forward from.",
    },
    {
      anchor: "intake-learned",
      title: "What it has learned",
      body:
        "Patterns picked up from files you already sorted, like which job a folder name belongs to. It only fills in blanks and never overrules what you chose.",
    },
    {
      anchor: "intake-summary",
      title: "How many are waiting",
      body:
        "How many files are ready to file and how many need a look from you. Nothing is filed until you confirm it.",
    },
    {
      anchor: "intake-empty",
      title: "Nothing waiting",
      body:
        "Every file you drop in gets a row here with a guess at what it is. The links below go to where that paperwork is kept.",
    },
    {
      anchor: "intake-table",
      title: "Check each row",
      body:
        "Each file has a guess at what it is and which job it goes with — change either on the row if it is wrong. Press Confirm on a row, or Confirm all, to file them; Dismiss drops a file you do not need.",
    },
  ],
};
