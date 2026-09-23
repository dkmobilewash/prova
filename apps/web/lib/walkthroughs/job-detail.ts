import type { Walkthrough } from "./types";

/**
 * /jobs/[id] — the Overview tab: job details, status, schedule & crew,
 * and the contract's own paper trail (e-sign / DocuSign / uploaded
 * subcontract).
 *
 * Split 2026-09-20 out of a single walkthrough that used to cover the
 * whole job page. That page became eight routes (see the sibling
 * `job-detail-*.ts` files in this directory and each tab's own
 * `page.tsx` under `app/(app)/jobs/[id]/(tabs)/`) so a section could
 * fetch only its own data and be reached by its own URL — see
 * `apps/web/components/BidWizardSteps.tsx`'s doc comment for the pattern
 * this follows. A walkthrough only ever covers ONE route
 * (`walkthroughCensus.test.ts`), so the seventeen steps that used to
 * live in one file are now one file per tab, each covering only the
 * anchors that actually render on it.
 */
export const jobDetailWalkthrough: Walkthrough = {
  route: "/jobs/[id]",
  title: "A job — overview",
  steps: [
    {
      anchor: "job-summary",
      title: "The job at a glance",
      body:
        "The job's name, who it is for, what the work is, and every priced line with the total. It is what your client sees when you send it to sign. Print prints this part only.",
    },
    {
      anchor: "job-details",
      title: "Fix the basics",
      body: "Change the job's name, the description of the work, or who it is for. Press Save details when you are done.",
    },
    {
      anchor: "job-status",
      title: "Where the job is",
      body:
        "Estimate, contracted, in progress or complete. An estimate becomes contracted further down this page, once it is signed. After that, press the button here when the work starts, and again when it is finished.",
    },
    {
      anchor: "job-schedule",
      title: "Dates and crew",
      body:
        "Put in the start and end dates and press Save dates — the job then shows on the Schedule page. Underneath, pick a teammate and press Assign to put them on this job.",
    },
    {
      anchor: "job-signature",
      title: "Get it signed",
      body:
        "When the price is ready on the Estimate tab, press Create signing link and send the link to your client. They read the price and sign it on their phone or computer — no account needed.",
    },
    {
      anchor: "docusign-connect-hint",
      title: "Prefer DocuSign?",
      body:
        "C Stream's own signing link is the default. If your GC wants DocuSign, the account owner connects it once on Settings → Integrations, and a Send with DocuSign button appears here.",
    },
    {
      anchor: "docusign-send",
      title: "Send with DocuSign",
      body:
        "Instead of the link, press this to send the contract through your DocuSign account. Check the signer's name and email, then press Send for signature. It works the same on an uploaded subcontract and on a submitted change order.",
    },
    {
      anchor: "docusign-envelope",
      title: "Where it stands",
      body:
        "Each envelope says whether it was sent, opened, signed, declined or voided, with DocuSign's own times. Once everyone signs, the signed copy and DocuSign's certificate are saved here, and a signed contract counts as executed.",
    },
    {
      anchor: "docusign-refresh",
      title: "Check now",
      body:
        "Press Refresh to ask DocuSign where the envelope stands right now. The account owner can Void an envelope that went to the wrong person — it is cancelled at DocuSign, and the record stays here.",
    },
  ],
};
