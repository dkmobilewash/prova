import type { Walkthrough } from "./types";

/** /catalog — the line items you price with again and again. */
export const catalogWalkthrough: Walkthrough = {
  route: "/catalog",
  title: "Your price list",
  steps: [
    {
      anchor: "catalog-import",
      title: "Bring in a price list you already have",
      body:
        "Press Import a price list to paste rows from a spreadsheet or pick the file. You see what will be added before anything is saved.",
    },
    {
      anchor: "catalog-empty",
      title: "Nothing saved yet",
      body:
        "Your saved line items will be listed here. Add one with the form at the bottom of the page, or import a list.",
    },
    {
      anchor: "catalog-list",
      title: "Your saved line items",
      body:
        "Each one shows its unit, price, cost and trade. Once a finished job has used it, you also see what it really cost you, and a button to update the price if it was off.",
    },
    {
      anchor: "catalog-add",
      title: "Add one by hand",
      body:
        "Type a description, like “5/8 drywall, hung and taped”, and whatever prices you know, then press Add entry. Only the description is needed.",
    },
  ],
};
