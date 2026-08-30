import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";

export default async function ContactsPage() {
  const { company } = await requireCompanyContext();

  const contacts = await prisma.contact.findMany({
    where: { companyId: company.id },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          jobs: true,
          bidInvitations: { where: { status: { in: ["INVITED", "SUBMITTED"] } } },
        },
      },
    },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-ink">Contacts</h1>

      {contacts.length === 0 ? (
        <p className="text-ink-body">
          No contacts yet — they&apos;re created automatically when you start a new job.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {contacts.map((contact) => (
            <li key={contact.id} className="p-4">
              <Link href={`/contacts/${contact.id}`} className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-100">{contact.name}</p>
                  <p className="text-sm text-slate-400">{contact.email ?? contact.phone ?? "No contact info"}</p>
                </div>
                <div className="text-right text-sm text-slate-400">
                  <p>
                    {contact._count.jobs} {contact._count.jobs === 1 ? "job" : "jobs"}
                  </p>
                  {contact._count.bidInvitations > 0 && (
                    <p className="text-xs text-blue-400">
                      {contact._count.bidInvitations} open{" "}
                      {contact._count.bidInvitations === 1 ? "bid" : "bids"}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
