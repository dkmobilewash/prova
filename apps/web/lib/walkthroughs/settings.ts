import type { Walkthrough } from "./types";

/** /settings — your company record, QuickBooks, and the papers a GC asks for. */
export const settingsWalkthrough: Walkthrough = {
  route: "/settings",
  title: "Settings",
  steps: [
    {
      anchor: "settings-owner-only",
      title: "Owner only",
      body:
        "Only the account owner can change settings. Ask whoever set up C Stream for your company if something here needs changing.",
    },
    {
      anchor: "settings-integrations",
      title: "Connect other apps",
      body: "Tap Integrations to connect or disconnect other services you use.",
    },
    {
      anchor: "settings-export",
      title: "Take your records with you",
      body: "Tap Export core records to download your jobs, prices, costs and hours as spreadsheet files.",
    },
    {
      anchor: "settings-import",
      title: "Bring in a spreadsheet",
      body:
        "Tap Import from a spreadsheet to bring in the clients, jobs and crew you already keep in Excel or Google Sheets.",
    },
    {
      anchor: "settings-company",
      title: "Your company details",
      body:
        "Fill in your company name, address and the rest, then press Save company record. They are printed on payroll forms and papers a GC signs, so a blank here is a blank there.",
    },
    {
      anchor: "settings-quickbooks",
      title: "QuickBooks",
      body:
        "Press Connect QuickBooks to send your invoices into QuickBooks Online. It only sends one way — changes made in QuickBooks do not come back here.",
    },
    {
      anchor: "quickbooks-not-set-up",
      title: "QuickBooks isn't set up yet",
      body:
        "This install doesn't have the QuickBooks app keys yet, so there is nothing to press. Whoever runs C Stream for you adds them, and then a Connect QuickBooks button appears here.",
    },
    {
      anchor: "qbo-import-connect-first",
      title: "Bring your QuickBooks lists in",
      body:
        "To bring your QuickBooks customers, vendors and products into C Stream, connect QuickBooks first. An Import from QuickBooks button then appears here.",
    },
    {
      anchor: "qbo-import",
      title: "Import from QuickBooks",
      body:
        "Press Import from QuickBooks to see which customers, vendors and products would come across. Nothing is saved yet, and nothing in QuickBooks is changed.",
    },
    {
      anchor: "qbo-import-preview",
      title: "Check what comes across",
      body:
        "Each list shows what will be added, what is already in C Stream, and anything skipped with the reason. Customers become clients and products become catalog entries.",
    },
    {
      anchor: "qbo-import-confirm",
      title: "Save them",
      body:
        "When it looks right, press Confirm. Only new ones are added, so importing again later is safe.",
    },
    {
      anchor: "settings-locations",
      title: "Offices and yards",
      body: "Open Add a location to record each office, yard or warehouse you run work out of.",
    },
    {
      anchor: "settings-licences",
      title: "Your licences",
      body:
        "Press Add a licence for each contractor licence you hold, with its expiry date. They show up on the Compliance page when renewal comes round.",
    },
    {
      anchor: "settings-phase-codes",
      title: "Your cost codes",
      body:
        "Press Add a phase code and type a number and a name, the way your budget already writes them. Put them on line items and the Phase codes page adds them up across every job.",
    },
    {
      anchor: "settings-insurance",
      title: "Insurance",
      body: "Open Add a policy to record each insurance policy, so you have it to hand when a GC asks.",
    },
    {
      anchor: "settings-bonding",
      title: "Bonding",
      body: "Open Add a bond to record your bonds and your bonding agent's details.",
    },
  ],
};
