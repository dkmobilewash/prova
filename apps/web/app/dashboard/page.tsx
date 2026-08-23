import Link from "next/link";
import { StatusBadge } from "@prova/ui";
import { JobStatus, Prisma, prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";

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
    <main className="mx-auto max-w-3xl px-4 py-10">
      <AppHeader companyName={company.name} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/jobs/new"
          className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          New job
        </Link>

        <form className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search job or client name"
            className="w-56 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
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
            className="rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-200"
          >
            Filter
          </button>
          {hasActiveFilters && (
            <Link href="/dashboard" className="text-sm text-slate-500 underline">
              Clear
            </Link>
          )}
        </form>
      </div>

      {totalJobCount === 0 ? (
        <p className="text-slate-500">No jobs yet. Create one to get started.</p>
      ) : jobs.length === 0 ? (
        <p className="text-slate-500">No jobs match your search.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
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
                      <p className="font-medium">{job.name}</p>
                      <StatusBadge status={job.status} />
                    </div>
                    <p className="text-sm text-slate-500">{job.contact.name}</p>
                  </div>
                  <p className="text-sm font-medium">${total.toFixed(2)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
