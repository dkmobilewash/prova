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

  // Nothing at all, rather than nothing scheduled. The page's only previous
  // empty state said "No jobs scheduled yet", which on a new account reads
  // as though the scheduling is the missing step when the job is.
  if (scheduled.length === 0 && unscheduled.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-6 text-xl font-semibold text-slate-100">Schedule</h1>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-6">
          <p className="text-slate-300">No jobs yet, so there is nothing to lay out.</p>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            This page puts every job on one list in start-date order, with the crew assigned to each —
            so you can see the week a second job wants the same three hangers as the first. A job
            starts here without a date and moves up once you set one; nothing is scheduled for you.
          </p>
          <Link
            href="/jobs/new"
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500"
          >
            Create a job
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-slate-100">Schedule</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Scheduled</h2>
        {scheduled.length === 0 ? (
          <p className="text-slate-400">
            Nothing has a start date yet. Open a job below and set one in its Schedule section — until
            then it stays under Unscheduled and appears on no week.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {scheduled.map((job) => (
              <li key={job.id} className="p-4">
                <Link href={`/jobs/${job.id}`} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-100">{job.name}</p>
                      <StatusBadge status={job.status} />
                    </div>
                    <p className="text-sm text-slate-400">{job.contact.name}</p>
                    {job.assignments.length > 0 && (
                      <p className="mt-1 text-xs text-slate-500">
                        Crew: {job.assignments.map((a) => a.user.name ?? a.user.email).join(", ")}
                      </p>
                    )}
                  </div>
                  <p className="whitespace-nowrap text-sm text-slate-300">
                    {formatDate(job.startDate!)}
                    {job.endDate ? ` – ${formatDate(job.endDate)}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ALWAYS RENDERED once there is a job, where it used to disappear
          when empty. "Every job has a start date" is the thing you came to
          check, and a section that vanishes when its answer is "none" is
          one you cannot use to confirm it. */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Unscheduled</h2>
        {unscheduled.length === 0 ? (
          <p className="text-slate-400">Every job has a start date.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {unscheduled.map((job) => (
              <li key={job.id} className="p-4">
                <Link href={`/jobs/${job.id}`} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-100">{job.name}</p>
                    <StatusBadge status={job.status} />
                  </div>
                  <p className="text-sm text-slate-400">{job.contact.name}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
