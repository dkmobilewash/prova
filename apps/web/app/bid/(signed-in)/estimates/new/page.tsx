import Link from "next/link";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { loadGcOptions } from "@/lib/jobs/gc-options";
import { NewJobForm } from "@/components/NewJobForm";
import { BidNoAccess } from "@/components/bid/BidNoAccess";
import { BID_CAPABILITY } from "@/components/bid/bidNav";

export const metadata = { title: "Start an estimate" };

/**
 * C Stream Bid — start an estimate: a job name, a scope, and the GC.
 *
 * THE CRM'S OWN FORM (`NewJobForm`) over the CRM's own picker (`loadGcOptions`),
 * posting to the CRM's own `createJob`. What makes it Bid's is one hidden field,
 * `returnTo=bid`, which `createJob` turns into a Bid path from a fixed list
 * (`lib/bid/jobStartDestination.ts`) — never a URL from the form. So the job
 * is created exactly as the CRM creates it (the same `createEstimateJob`, the
 * same GC rules, a half-finished estimate is a real row) and the person lands
 * on the estimate's takeoff rather than the CRM's "add work" stepper.
 *
 * `BidWizardSteps` is not used: it is the CRM's two-step stepper with its step
 * hrefs hard-coded to `/jobs/new…`, and Bid has no second step — the
 * estimate's own tabs are where the work is added.
 *
 * Adding a GC here is the form's own "+ Add a new GC": the same contact create
 * the CRM does, with no contact page to link to.
 */
export default async function BidStartEstimatePage() {
  const { context, allowed } = await requireCapability(BID_CAPABILITY);
  if (!allowed) return <BidNoAccess />;
  const options = await loadGcOptions(context.company.id);

  return (
    <PageShell width="reading">
      <p className="mb-2 text-sm">
        <Link href="/bid/estimates" className="inline-flex min-h-11 items-center text-link hover:underline">
          ← All estimates
        </Link>
      </p>
      <h1 className="mb-1 font-headline text-3xl font-semibold text-ink">Start an estimate</h1>
      <p className="mb-6 max-w-prose text-sm text-ink-body">
        Name the job and pick the GC. It starts as an estimate — you will upload the drawings on the next screen.
      </p>
      <NewJobForm contacts={options} returnTo="bid" submitLabel="Start the estimate — upload the drawings next →" />
    </PageShell>
  );
}
