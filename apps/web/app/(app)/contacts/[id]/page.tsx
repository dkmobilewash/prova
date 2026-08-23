import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { StatusBadge } from "@prova/ui";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { enablePortalAccess, updateContact } from "@/lib/actions";
import { money } from "@/lib/money";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { company } = await requireCompanyContext();

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      jobs: {
        orderBy: { createdAt: "desc" },
        include: { lineItems: { where: { isDeleted: false } } },
      },
    },
  });

  if (!contact || contact.companyId !== company.id) {
    notFound();
  }

  const updateContactWithId = updateContact.bind(null, contact.id);
  const enablePortalWithId = enablePortalAccess.bind(null, contact.id);

  const headerList = await headers();
  const origin = `${headerList.get("x-forwarded-proto") ?? "https"}://${headerList.get("host")}`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h1 className="mb-4 text-lg font-semibold text-slate-100">Edit contact</h1>
        <form action={updateContactWithId} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Name
            <input
              name="name"
              defaultValue={contact.name}
              required
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Email
            <input
              name="email"
              type="email"
              defaultValue={contact.email ?? ""}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Phone
            <input
              name="phone"
              defaultValue={contact.phone ?? ""}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Address
            <input
              name="address"
              defaultValue={contact.address ?? ""}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="mt-2 inline-flex w-fit items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Save
          </button>
        </form>
      </section>

      <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900 p-6">
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Client portal</h2>
        {contact.portalToken ? (
          <div className="text-sm">
            <p className="mb-2 text-slate-300">
              Share this link so {contact.name} can view their jobs, contracts, and invoices:
            </p>
            <p className="break-all rounded-md bg-slate-950 px-3 py-2 font-mono text-xs text-blue-400">
              {origin}/portal/{contact.portalToken}
            </p>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-sm text-slate-400">
              No portal access yet. This gives {contact.name} a read-only link to view their jobs
              — no login required.
            </p>
            <form action={enablePortalWithId}>
              <button
                type="submit"
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
              >
                Enable client portal
              </button>
            </form>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Jobs</h2>
        {contact.jobs.length === 0 ? (
          <p className="text-slate-400">No jobs for this contact yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {contact.jobs.map((job) => {
              const total = job.lineItems.reduce(
                (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
                0,
              );
              return (
                <li key={job.id} className="p-4">
                  <Link href={`/jobs/${job.id}`} className="flex items-center justify-between gap-3">
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
      </section>
    </div>
  );
}
