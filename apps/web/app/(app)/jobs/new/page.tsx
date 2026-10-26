import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
import { requireCompanyContext } from "@/lib/auth";
import { NewJobForm } from "@/components/NewJobForm";
import { loadGcOptions } from "@/lib/jobs/gc-options";
import { BidWizardSteps } from "@/components/BidWizardSteps";

/**
 * The GC list is loaded here rather than inside the form so the picker
 * shows real rows on first paint — a picker that fills in after a spinner
 * invites the "add a new one" click this page exists to stop.
 *
 * Ordered by how much work is on record with each, so the GC somebody is
 * most likely opening a job for is near the top and the accidental
 * duplicate with nothing on it sits at the bottom.
 *
 * Step 1 of the bid-creation stepper — see `BidWizardSteps`'s own comment
 * for the shape and why it is three real URLs rather than client wizard
 * state. This step alone has no `jobId` yet, which is exactly why it is
 * the one step that must exist as a page rather than a URL segment under
 * one: `createJob` is what mints the id the other two steps are keyed on.
 */
export default async function NewJobPage() {
  const { company } = await requireCompanyContext();

  const options = await loadGcOptions(company.id);

  return (
    <PageShell width="reading">
      {/* "New job", the same words as every button that opens this page —
          it used to say "Start a bid" under a "+ New job" button (UX test
          2026-10-11). The bid is the stage the job starts at, said below. */}
      <PageHeader
        route="/dashboard"
        parent={{ href: "/jobs", label: "Jobs" }}
        title="New job"
        subtitle="It starts as a bid. Name it and pick the GC — you'll add the work itself on the next screen."
      />
      <BidWizardSteps current={1} />
      <NewJobForm contacts={options} />
    </PageShell>
  );
}
