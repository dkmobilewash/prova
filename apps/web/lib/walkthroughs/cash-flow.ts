import type { Walkthrough } from "./types";

/** /cash-flow — who owes you, and when the money should land. */
export const cashFlowWalkthrough: Walkthrough = {
  route: "/cash-flow",
  title: "Cash flow",
  steps: [
    {
      anchor: "cash-flow-empty",
      title: "Nothing billed yet",
      body:
        "Every number on this page comes from invoices, so it stays empty until you bill a job. Invoices are made on the job's own page, in its Invoices section.",
    },
    {
      anchor: "cash-flow-forecast",
      title: "When the money should come in",
      body:
        "Month by month, what should arrive, worked out from due dates and finish dates you already entered. Nothing here is a guess.",
    },
    {
      anchor: "cash-flow-aging",
      title: "Who owes you, and how late",
      body:
        "The boxes add up what you are owed by how long it has been owed. Open Outstanding invoices to see each one, with the contractor, what is left to pay, and how many days late it is.",
    },
    {
      anchor: "cash-flow-retainage",
      title: "Money held back",
      body:
        "Retainage is the part of each payment the contractor keeps until the job is finished. This shows how much each job is holding and roughly when you should get it.",
    },
    {
      anchor: "cash-flow-wip",
      title: "For your accountant or bonding company",
      body:
        "Press Download WIP schedule, at the top of the page, to get a spreadsheet of how far along each job is and whether you have billed ahead or behind. It opens in Excel or Google Sheets.",
    },
  ],
};
