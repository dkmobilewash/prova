import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { NewJobForm } from "@/components/NewJobForm";

/**
 * The GC list is loaded here rather than inside the form so the picker
 * shows real rows on first paint — a picker that fills in after a spinner
 * invites the "add a new one" click this page exists to stop.
 *
 * Ordered by how much work is on record with each, so the GC somebody is
 * most likely opening a job for is near the top and the accidental
 * duplicate with nothing on it sits at the bottom.
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
      <h1 className="mb-6 text-xl font-semibold text-slate-100">New job</h1>
      <NewJobForm contacts={options} />
    </div>
  );
}
