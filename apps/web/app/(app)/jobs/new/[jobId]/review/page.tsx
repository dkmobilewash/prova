import { redirect } from "next/navigation";

/**
 * THE WIZARD'S OLD STEP 3, KEPT ONLY SO ITS URL STILL LANDS SOMEWHERE.
 *
 * "Review" collected nothing — the file that used to live here said so
 * itself: "there is nothing left this step needs to collect that steps 1
 * and 2 didn't already save as it was typed, so 'Finish' is a plain link
 * rather than a submit". What it rendered was the job name, the GC and the
 * line items, every one of which the reader had just typed on the two
 * screens behind it and every one of which the job page shows anyway. So
 * it cost a click and returned a second reading of his own handwriting.
 * See `components/BidWizardSteps.tsx` for the longer argument.
 *
 * This file is a redirect rather than a deletion because the route was
 * live: a tab left open on it, or a browser-history entry, would otherwise
 * hit a 404 the day this merges. It sends the reader to the job, which is
 * exactly where the step's own "Finish" button went.
 *
 * Deliberately no auth or ownership check before redirecting. It reads
 * nothing and reveals nothing — `/jobs/[id]` does the checking, and
 * `requireJob` there 404s a job that is not this company's. A lookup here
 * would be a second place for that rule to be written and to drift.
 *
 * Safe to delete once nothing points here. Nothing in the app does today.
 */
export default async function NewJobReviewRedirect({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  redirect(`/jobs/${jobId}`);
}
