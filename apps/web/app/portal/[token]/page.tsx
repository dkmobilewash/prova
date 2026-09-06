import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@prova/ui";
import { prisma } from "@prova/db";
import { portalAccessFor } from "@/lib/link-access";
import { money } from "@/lib/money";

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const contact = await prisma.contact.findUnique({
    where: { portalToken: token },
    include: {
      company: true,
      jobs: {
        orderBy: { createdAt: "desc" },
        include: { lineItems: { where: { isDeleted: false } } },
      },
    },
  });

  // A token that never existed and a token that is no longer allowed are the
  // same 404 on purpose. Anything more would tell someone trying tokens
  // which of their guesses hit a real contact — and there is no login here
  // to slow them down. See lib/link-access.ts.
  if (!contact || !portalAccessFor(contact).ok) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-sm font-medium text-slate-500">{contact.company.name}</p>
      <h1 className="mb-6 text-xl font-semibold text-slate-100">Hi, {contact.name}</h1>

      {contact.jobs.length === 0 ? (
        <p className="text-slate-400">No jobs yet.</p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {contact.jobs.map((job) => {
            const total = job.lineItems.reduce(
              (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
              0,
            );
            return (
              <li key={job.id} className="p-4">
                <Link
                  href={`/portal/${token}/jobs/${job.id}`}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-100">{job.name}</p>
                    <StatusBadge status={job.status} />
                  </div>
                  <p className="text-sm font-medium text-slate-100">{money(total)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
