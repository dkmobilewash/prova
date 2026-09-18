import type { Walkthrough } from "./types";

/** /compliance — insurance, lien waivers and the paperwork a GC asks for. */
export const complianceWalkthrough: Walkthrough = {
  route: "/compliance",
  title: "Compliance papers",
  steps: [
    {
      anchor: "compliance-renewals",
      title: "What is running out",
      body:
        "Insurance, licences and bonds that have run out or are about to. The dates come from what you entered in Settings, so if this box says nothing is tracked, put them in there first.",
    },
    {
      anchor: "compliance-mod-rate",
      title: "Your mod rate",
      body:
        "The experience mod rate on your workers' comp, which contractors ask for on prequalification forms. Press Record a mod rate and copy it from the worksheet your insurance broker sent.",
    },
    {
      anchor: "compliance-upload",
      title: "Upload a document",
      body:
        "Pick a scan or photo of a lien waiver, insurance certificate or payroll form, choose the job if it belongs to one, and press Upload & extract. The app reads it into fields you can check and fix.",
    },
    {
      anchor: "compliance-empty",
      title: "Nothing filed yet",
      body: "Documents you upload will be listed here, newest first.",
    },
    {
      anchor: "compliance-documents",
      title: "Your documents",
      body:
        "Each one shows what it is, who it is from and when it runs out. Press Edit to fix anything the app read wrong, or Mark received once a document you were waiting for arrives.",
    },
  ],
};
