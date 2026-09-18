import type { Walkthrough } from "./types";

/** /settings/integrations — the other apps this company connects to. */
export const settingsIntegrationsWalkthrough: Walkthrough = {
  route: "/settings/integrations",
  title: "Integrations",
  steps: [
    {
      anchor: "integrations-owner-only",
      title: "Owner only",
      body: "Only the account owner can connect or disconnect other apps. Ask them if something here needs changing.",
    },
    {
      anchor: "integrations-intro",
      title: "Other apps you connect",
      body:
        "This is where C Stream links up with the other software you use. Connecting one never lets it see another company's data.",
    },
    {
      anchor: "integrations-list",
      title: "One card per app",
      body:
        "Each card says whether it is connected. QuickBooks is set up from Settings — press Manage in Settings on its card. Cards marked Coming soon are not built yet.",
    },
    {
      anchor: "jobber-not-set-up",
      title: "Jobber isn't set up yet",
      body:
        "This install doesn't have the Jobber app keys yet, so there is nothing to press. Whoever runs C Stream for you adds them, and then a Connect button appears here.",
    },
    {
      anchor: "jobber-connect",
      title: "Connect Jobber",
      body:
        "Press Connect to sign in to Jobber and let C Stream read your account. C Stream only reads — it never changes anything in Jobber.",
    },
    {
      anchor: "jobber-import",
      title: "Bring your Jobber work in",
      body:
        "Press Import from Jobber. C Stream reads your clients, jobs and open quotes and shows you what would come across. Nothing is saved yet.",
    },
    {
      anchor: "jobber-preview",
      title: "Check what will come across",
      body:
        "For clients and for jobs you see how many are new, how many are already in C Stream, and any with a problem and why. Every job comes in as an estimate.",
    },
    {
      anchor: "jobber-properties",
      title: "Addresses",
      body:
        "Jobber's property addresses become the site address on each job, and fill in a client's address when Jobber had none.",
    },
    {
      anchor: "jobber-confirm",
      title: "Save them",
      body:
        "When it looks right, press Confirm. Only new ones are added, so running the import again later is safe — it skips everything already here.",
    },
    {
      anchor: "integrations-storage",
      title: "Where photos are kept",
      body: "This shows where site photos are stored. Nothing to do here unless something looks wrong.",
    },
  ],
};
