import type { Walkthrough } from "./types";

/**
 * /jobs/[id] — one job, from estimate to finished.
 *
 * The page changes shape as the job moves: the price lines and "Ready to
 * lock this in?" exist only while it is an estimate, invoices only after.
 * Steps for both stages are listed, in the order the page shows them; the
 * tour shows the ones on screen.
 *
 * Time entry lives here on the web (the "Field time entries" section). The
 * clock in / clock out buttons from #309 are on the phone app, not on any
 * web page, so the time step says where they are rather than pointing at
 * something this page does not have.
 */
export const jobDetailWalkthrough: Walkthrough = {
  route: "/jobs/[id]",
  title: "A job",
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
        "When the price further down is ready, press Create signing link and send the link to your client. They read the price and sign it on their phone or computer — no account needed.",
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
    {
      anchor: "job-time",
      title: "Hours worked",
      body:
        "Record who worked, which day and how many hours, then press Log time. Your crew can also clock in and out from the C Stream phone app, and those hours show up here too.",
    },
    {
      anchor: "job-invoices",
      title: "Bill the job",
      body:
        "Press Create invoice to bill the job. When the client pays, use Log payment on that invoice so you always know what is still owed.",
    },
    {
      anchor: "job-line-items",
      title: "Price the job",
      body:
        "These are the lines of your estimate. Describe the work in the box and press Draft line items to have them written for you, or use Add from a takeoff if you have measurements. Check every line — you can change any of them.",
    },
    {
      anchor: "job-add-line-item",
      title: "Add a line yourself",
      body:
        "Type what it is, how many, the unit and the price, then press Add line item. If you have saved prices in your catalog, you can pick one under Add from catalog.",
    },
    {
      anchor: "job-lock-in",
      title: "Lock the price in",
      body:
        "Once the contract is signed, press Mark as contracted here. After that, any change to the price goes through a change order, so there is a record of it.",
    },
    {
      anchor: "job-change-orders",
      title: "Changes after signing",
      body:
        "When the client asks for extra work once the job is contracted, give it a name under New change order and add what changes. It only moves the price once they agree to it.",
    },
    {
      anchor: "job-field-reports",
      title: "A note for each day",
      body:
        "Press Log a day to write what happened on site: who was there, what got done, the weather, and anything that held you up. It is your record if there is ever an argument about the job.",
    },
    {
      anchor: "job-photos",
      title: "Photos, video and voice notes",
      body:
        "Add pictures, a short video or a voice note from the site. On a phone this opens the camera. A photo of the place before you start is the one people most wish they had.",
    },
  ],
};
