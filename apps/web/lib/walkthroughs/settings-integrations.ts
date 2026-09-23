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
      anchor: "docusign-not-set-up",
      title: "DocuSign isn't set up yet",
      body:
        "This install doesn't have the DocuSign app keys yet, so there is nothing to press. C Stream's own signing links work without it.",
    },
    {
      anchor: "docusign-connect",
      title: "Connect DocuSign",
      body:
        "Press Connect and sign in to your DocuSign account. After that, contracts and change orders on each job offer Send with DocuSign beside C Stream's own signing link.",
    },
    {
      anchor: "docusign-details",
      title: "Your DocuSign account",
      body:
        "This shows which DocuSign account envelopes are sent from, and whether their status updates arrive by themselves or when you press Refresh.",
    },
    {
      anchor: "mycoi-import-link",
      title: "Bring in myCOI",
      body:
        "Press Import a myCOI export to bring your vendors' insurance in from a file you export from myCOI. You check it before anything is saved.",
    },
    {
      anchor: "mycoi-live-api",
      title: "Why there is no Connect button",
      body:
        "myCOI does not offer a live connection to other apps without an agreement with them, so for now it comes in as a file. This line says so, so nobody waits for a sync that isn't there.",
    },
    {
      anchor: "procore-not-set-up",
      title: "Procore isn't set up yet",
      body:
        "This install doesn't have the Procore app keys yet, so there is nothing to press. Whoever runs C Stream for you adds them.",
    },
    {
      anchor: "procore-connect",
      title: "Connect Procore",
      body:
        "Press Connect and sign in with your own Procore login, the one your GCs invite to their projects. C Stream only reads, never changes anything there.",
    },
    {
      anchor: "procore-links",
      title: "Which GC project feeds which job",
      body:
        "Each line is a GC's Procore project linked to one of your jobs. Its drawings, RFIs and submittals show on that job's pages.",
    },
    {
      anchor: "procore-link",
      title: "Link a project",
      body:
        "Press Link a Procore project to a job. C Stream asks Procore which projects you can see.",
    },
    {
      anchor: "procore-link-form",
      title: "Pick the project and your job",
      body:
        "Choose the GC's project and your job, then press Link. If a GC's company is listed with a note, their Procore admin has to add the C Stream app first.",
    },
    {
      anchor: "acc-not-set-up",
      title: "ACC isn't set up yet",
      body:
        "This install doesn't have the Autodesk Construction Cloud app keys yet, so there is nothing to press. Whoever runs C Stream for you adds them.",
    },
    {
      anchor: "acc-connect",
      title: "Connect Autodesk Construction Cloud",
      body:
        "Press Connect and sign in with your own ACC login, the one your GCs invite to their projects. C Stream only reads, never changes anything there.",
    },
    {
      anchor: "acc-links",
      title: "Which GC project feeds which job",
      body:
        "Each line is a GC's ACC project linked to one of your jobs. Its RFIs and submittals show on that job's pages.",
    },
    {
      anchor: "acc-link",
      title: "Link a project",
      body: "Press Link an ACC project to a job. C Stream asks Autodesk which projects you can see.",
    },
    {
      anchor: "acc-link-form",
      title: "Pick the project and your job",
      body:
        "Choose the GC's project and your job, then press Link. If an account is listed with a note, their ACC account admin has to add the C Stream app first.",
    },
    {
      anchor: "companycam-not-set-up",
      title: "CompanyCam isn't set up yet",
      body:
        "This install doesn't have the CompanyCam app keys yet, so there is nothing to press. Whoever runs C Stream for you adds them.",
    },
    {
      anchor: "companycam-connect",
      title: "Connect CompanyCam",
      body:
        "Press Connect and sign in with your company's CompanyCam account. C Stream only reads — it never changes anything in CompanyCam.",
    },
    {
      anchor: "companycam-links",
      title: "Which CompanyCam project feeds which job",
      body:
        "Each line is a CompanyCam project linked to one of your jobs. Press Import photos on it to pull its photos into that job's gallery.",
    },
    {
      anchor: "companycam-link",
      title: "Link a project",
      body: "Press Link a CompanyCam project to a job. C Stream asks CompanyCam which projects your account can see.",
    },
    {
      anchor: "companycam-link-form",
      title: "Pick the project and your job",
      body: "Choose the CompanyCam project and your job, then press Link.",
    },
    {
      anchor: "companycam-import",
      title: "Bring the photos in",
      body:
        "Press Import photos. Each one lands in the job's own gallery, captioned and dated by when it was taken. Pressing it again only brings photos that aren't here yet.",
    },
    {
      anchor: "bluebeam-not-set-up",
      title: "Bluebeam isn't set up yet",
      body:
        "This install doesn't have the Bluebeam app keys yet, so there is nothing to press. Whoever runs C Stream for you adds them.",
    },
    {
      anchor: "bluebeam-connect",
      title: "Connect Bluebeam",
      body:
        "Press Connect and sign in with your own Bluebeam account. C Stream can then create Studio Sessions and push files into them on your behalf.",
    },
    {
      anchor: "bluebeam-details",
      title: "Your Bluebeam account",
      body:
        "This shows which Bluebeam account is connected and what syncs back from a session: a file count and markup status only — no drawing geometry, no takeoff quantities.",
    },
    {
      anchor: "bluebeam-links",
      title: "Which job talks to which Studio Session",
      body:
        "Each line is a job with its own Bluebeam Studio Session. Push a PDF into it, then press Refresh to see how many markups have come back.",
    },
    {
      anchor: "bluebeam-link",
      title: "Link a job",
      body: "Press Link a job to a new Studio Session. Bluebeam creates a fresh session for that job.",
    },
    {
      anchor: "bluebeam-link-form",
      title: "Pick the job",
      body: "Choose which of your jobs this Studio Session is for, then press Link.",
    },
    {
      anchor: "bluebeam-push",
      title: "Push a PDF in",
      body:
        "Press Push a PDF and choose a drawing set or spec section from your computer. It goes straight into that job's Studio Session — nothing about the file is kept in C Stream.",
    },
    {
      anchor: "bluebeam-refresh",
      title: "Check on the markups",
      body:
        "Press Refresh to see how many files are in the session and how many markups they have, grouped by status.",
    },
    {
      anchor: "integrations-storage",
      title: "Where photos are kept",
      body: "This shows where site photos are stored. Nothing to do here unless something looks wrong.",
    },
  ],
};
