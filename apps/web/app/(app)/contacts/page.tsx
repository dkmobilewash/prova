import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";

export default async function ContactsPage() {
  const { company } = await requireCompanyContext();

  const contacts = await prisma.contact.findMany({
    where: { companyId: company.id },
    orderBy: { name: "asc" },
    include: { _count: { select: { jobs: true } } },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-slate-100">Contacts</h1>

      {contacts.length === 0 ? (
        <p className="text-slate-400">
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
                <p className="text-sm text-slate-400">
                  {contact._count.jobs} {contact._count.jobs === 1 ? "job" : "jobs"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
