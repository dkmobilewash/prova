import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { NewJobForm } from "@/components/NewJobForm";
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

  const contacts = await prisma.contact.findMany({
    where: { companyId: company.id },
    select: {
      id: true,
      name: true,
      email: true,
      _count: { select: { jobs: true } },
    },
    orderBy: [{ name: "asc" }],
  });

  const options = contacts
    .map((contact) => ({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      jobCount: contact._count.jobs,
    }))
    .sort((a, b) => b.jobCount - a.jobCount || a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <BidWizardSteps current={1} />
      <h1 className="mb-1 text-xl font-semibold text-ink">Start a bid</h1>
      <p className="mb-6 text-sm text-ink-body">
        Name it and pick the GC — you&apos;ll add the work itself on the next screen.
      </p>
      <NewJobForm contacts={options} />
    </div>
  );
}
