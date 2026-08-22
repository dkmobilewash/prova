import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";

export default async function DashboardPage() {
  const { company } = await requireCompanyContext();

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    include: { contact: true, lineItems: { where: { isDeleted: false } } },
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{company.name}</h1>
          <p className="text-sm text-slate-600">Jobs</p>
        </div>
        <UserButton />
      </div>

      <div className="mb-6">
        <Link
          href="/jobs/new"
          className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          New job
        </Link>
      </div>

      {jobs.length === 0 ? (
        <p className="text-slate-500">No jobs yet. Create one to get started.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {jobs.map((job) => {
            const total = job.lineItems.reduce(
              (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
              0,
            );
            return (
              <li key={job.id} className="p-4">
                <Link href={`/jobs/${job.id}`} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{job.name}</p>
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
