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
      anchor: "import-clients",
      title: "Start with clients",
      body:
        "Press Import clients to open this box. Clients first is easiest, because your jobs will need them.",
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
      anchor: "import-file",
      title: "Pick your file",
      body:
        "Save your sheet as a CSV file (in Excel: File, Save As, CSV) and choose it here. Not sure how to lay it out? Download a blank template and fill that in.",
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
  ],
};
