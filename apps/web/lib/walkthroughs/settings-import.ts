import type { Walkthrough } from "./types";

/** /settings/import — bring clients, jobs and crew in from a spreadsheet. */
export const settingsImportWalkthrough: Walkthrough = {
  route: "/settings/import",
  title: "Importing a spreadsheet",
  steps: [
    {
      anchor: "import-intro",
      title: "Bring in what you already have",
      body:
        "If you keep your clients, jobs or crew in Excel or Google Sheets, bring them in here instead of typing them again. Nothing is saved until you press Confirm.",
    },
    {
      anchor: "import-jobber",
      title: "Using Jobber?",
      body:
        "If your clients and jobs are in Jobber, you don't need a spreadsheet. Press Connect it instead to bring them straight across.",
    },
    {
      anchor: "import-quickbooks",
      title: "Using QuickBooks?",
      body:
        "If your customers, vendors and products are in QuickBooks Online, press Import from QuickBooks to bring them straight across. It only reads QuickBooks.",
    },
    {
      anchor: "import-clients",
      title: "Start with clients",
      body:
        "Press Import clients to open this box. Clients first is easiest, because your jobs will need them. This box also takes the contacts file your phone exports (.vcf) — people with a company land under that company.",
    },
    {
      anchor: "import-jobs",
      title: "Then jobs",
      body:
        "Press Import jobs. A jobs sheet can name clients who are not in yet — they are added for you. Every job comes in as an estimate.",
    },
    {
      anchor: "import-crew",
      title: "Then your crew",
      body: "Press Import crew to bring in the people who work for you.",
    },
    {
      anchor: "import-mycoi",
      title: "Insurance from myCOI",
      body:
        "If you track your vendors' and subs' insurance in myCOI, export it from there as a spreadsheet and press Import certificates — an Excel file works as-is. Each vendor's cover lands on Compliance with its expiry date.",
    },
    {
      anchor: "import-file",
      title: "Pick your file",
      body:
        "Choose your file here — an Excel file (.xlsx) works as-is, no saving as CSV first, and a CSV works too. Not sure how to lay it out? Download a blank template and fill that in.",
    },
    {
      anchor: "import-paste",
      title: "Or paste it",
      body:
        "You can also copy the cells straight from your spreadsheet and paste them into this box. The first row has to be the column names.",
    },
    {
      anchor: "import-preview",
      title: "Check before it is saved",
      body:
        "This shows how many will be added, how many are already in C Stream, and any rows with a problem and which line they are on. Fix the sheet and paste again if something looks wrong.",
    },
    {
      anchor: "import-confirm",
      title: "Save them",
      body:
        "When the preview looks right, press Confirm. Only new ones are added — nothing already in C Stream is changed, so importing the same file twice is safe.",
    },
    {
      anchor: "import-mycoi-preview",
      title: "Check the certificates",
      body:
        "This shows how many certificates will be added, which are already here, and any rows with a problem. Each row says whether the name matches a vendor you already have.",
    },
    {
      anchor: "import-mycoi-confirm",
      title: "Save the certificates",
      body:
        "Press Confirm to add them. Anything that has run out shows on Compliance and in your alerts straight away. Import next month's export the same way — a renewal replaces the old line.",
    },
  ],
};
