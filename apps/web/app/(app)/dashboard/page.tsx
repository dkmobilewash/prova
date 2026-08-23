import Link from "next/link";
import { StatusBadge } from "@prova/ui";
import { JobStatus, Prisma, prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";

const STATUS_OPTIONS: JobStatus[] = ["ESTIMATE", "CONTRACTED", "IN_PROGRESS", "COMPLETE"];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { company } = await requireCompanyContext();
  const { q, status } = await searchParams;

  const where: Prisma.JobWhereInput = { companyId: company.id };
  if (status && STATUS_OPTIONS.includes(status as JobStatus)) {
    where.status = status as JobStatus;
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { contact: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [jobs, totalJobCount] = await Promise.all([
    prisma.job.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { contact: true, lineItems: { where: { isDeleted: false } } },
    }),
    prisma.job.count({ where: { companyId: company.id } }),
  ]);

  const hasActiveFilters = Boolean(q || status);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-slate-100">Jobs</h1>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/jobs/new"
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          New job
        </Link>

        <form className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search job or client name"
            className="w-56 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
          >
            Filter
          </button>
          {hasActiveFilters && (
            <Link href="/dashboard" className="text-sm text-blue-400 hover:text-blue-300 hover:underline">
              Clear
            </Link>
          )}
        </form>
      </div>

      {totalJobCount === 0 ? (
        <p className="text-slate-400">No jobs yet. Create one to get started.</p>
      ) : jobs.length === 0 ? (
        <p className="text-slate-400">No jobs match your search.</p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {jobs.map((job) => {
            const total = job.lineItems.reduce(
              (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
              0,
            );
            return (
              <li key={job.id} className="p-4">
                <Link href={`/jobs/${job.id}`} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-100">{job.name}</p>
                      <StatusBadge status={job.status} />
                    </div>
                    <p className="text-sm text-slate-400">{job.contact.name}</p>
                  </div>
                  <p className="text-sm font-medium text-slate-100">${total.toFixed(2)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
