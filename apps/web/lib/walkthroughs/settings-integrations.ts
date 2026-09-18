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
      anchor: "integrations-storage",
      title: "Where photos are kept",
      body: "This shows where site photos are stored. Nothing to do here unless something looks wrong.",
    },
  ],
};
