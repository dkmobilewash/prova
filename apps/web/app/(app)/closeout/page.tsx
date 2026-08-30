import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { CloseoutJobCard } from "@/components/CloseoutJobCard";
import {
  isCloseoutComplete,
  isOpen,
  outstandingRequired,
  warrantyState,
} from "@/components/closeoutLabels";

/** Stored at UTC midnight, rendered in UTC — same rule as every other
 * dated record in this app. */
function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

export default async function CloseoutPage() {
  const { company, ...currentUser } = await requireCompanyContext();
  const today = new Date().toISOString().slice(0, 10);

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      closeoutItems: { orderBy: [{ isRequired: "desc" }, { name: "asc" }] },
      warrantyPeriod: true,
      warrantyServiceRequests: { orderBy: { reportedOn: "desc" } },
    },
  });

  const rows = jobs.map((job) => ({
    id: job.id,
    name: job.name,
    items: job.closeoutItems.map((i) => ({
      id: i.id,
      name: i.name,
      isRequired: i.isRequired,
      completedOn: isoDate(i.completedOn),
      note: i.note,
      documentUrl: i.documentUrl,
      documentName: i.documentName,
    })),
    warranty: job.warrantyPeriod
      ? {
          startsOn: isoDate(job.warrantyPeriod.startsOn) as string,
          months: job.warrantyPeriod.months,
          note: job.warrantyPeriod.note,
        }
      : null,
    requests: job.warrantyServiceRequests.map((r) => ({
      id: r.id,
      reportedOn: isoDate(r.reportedOn) as string,
      description: r.description,
      reportedBy: r.reportedBy,
      responsibility: r.responsibility,
      resolvedOn: isoDate(r.resolvedOn),
      resolutionNote: r.resolutionNote,
    })),
  }));

  // All three counted across every job, and all three derived — there is no
  // stored "closed out" or "in warranty" flag anywhere in this feature.
  const outstandingJobs = rows.filter((r) => r.items.length > 0 && !isCloseoutComplete(r.items)).length;
  const inWarranty = rows.filter((r) => warrantyState(r.warranty, today) === "ACTIVE").length;
  const openCallbacks = rows.reduce((n, r) => n + r.requests.filter(isOpen).length, 0);
  const totalOutstandingItems = rows.reduce((n, r) => n + outstandingRequired(r.items).length, 0);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Closeout &amp; warranty</h1>
      <p className="mb-6 text-sm text-slate-400">
        What&apos;s still owed before final payment, and what you&apos;re still on the hook for after
        it. Retainage is usually released against a closeout package, so a missing lien waiver is
        money sitting with the GC — and a callback logged after the warranty ran out is the
        difference between a favour and work you should be paid for.
      </p>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${outstandingJobs > 0 ? "text-amber-300" : "text-slate-100"}`}>
            {outstandingJobs}
          </p>
          <p className="text-xs text-slate-500">
            Jobs with closeout outstanding
            {totalOutstandingItems > 0 && ` · ${totalOutstandingItems} items`}
          </p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="text-2xl font-semibold text-blue-300">{inWarranty}</p>
          <p className="text-xs text-slate-500">Jobs still in warranty</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className={`text-2xl font-semibold ${openCallbacks > 0 ? "text-red-300" : "text-slate-100"}`}>
            {openCallbacks}
          </p>
          <p className="text-xs text-slate-500">Open callbacks</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-slate-400">
          No jobs yet. Closeout and warranty both hang off a job — create one and it will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {rows.map((job) => (
            <CloseoutJobCard
              key={job.id}
              job={job}
              today={today}
              canDelete={currentUser.role === "OWNER"}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
