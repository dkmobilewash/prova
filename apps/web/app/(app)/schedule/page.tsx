import Link from "next/link";
import { StatusBadge } from "@prova/ui";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { formatCalendarDate } from "@/lib/render-date";

function formatDate(date: Date) {
  return formatCalendarDate(date);
}

export default async function SchedulePage() {
  const { company } = await requireCompanyContext();

  const [scheduled, unscheduled] = await Promise.all([
    prisma.job.findMany({
      where: { companyId: company.id, startDate: { not: null } },
      orderBy: { startDate: "asc" },
      include: { contact: true, assignments: { include: { user: true } } },
    }),
    prisma.job.findMany({
      where: { companyId: company.id, startDate: null },
      orderBy: { createdAt: "desc" },
      include: { contact: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-ink">Schedule</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Scheduled</h2>
        {scheduled.length === 0 ? (
          <p className="text-ink-body">No jobs scheduled yet.</p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {scheduled.map((job) => (
              <li key={job.id} className="p-4">
                <Link href={`/jobs/${job.id}`} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-ink">{job.name}</p>
                      <StatusBadge status={job.status} />
                    </div>
                    <p className="text-sm text-ink-body">{job.contact.name}</p>
                    {job.assignments.length > 0 && (
                      <p className="mt-1 text-xs text-ink-muted">
                        Crew: {job.assignments.map((a) => a.user.name ?? a.user.email).join(", ")}
                      </p>
                    )}
                  </div>
                  <p className="whitespace-nowrap text-sm text-ink-label">
                    {formatDate(job.startDate!)}
                    {job.endDate ? ` – ${formatDate(job.endDate)}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {unscheduled.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-label">Unscheduled</h2>
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {unscheduled.map((job) => (
              <li key={job.id} className="p-4">
                <Link href={`/jobs/${job.id}`} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-ink">{job.name}</p>
                    <StatusBadge status={job.status} />
                  </div>
                  <p className="text-sm text-ink-body">{job.contact.name}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
