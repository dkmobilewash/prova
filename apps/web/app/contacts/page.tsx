import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";

export default async function ContactsPage() {
  const { company } = await requireCompanyContext();

  const contacts = await prisma.contact.findMany({
    where: { companyId: company.id },
    orderBy: { name: "asc" },
    include: { _count: { select: { jobs: true } } },
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <AppHeader companyName={company.name} />

      <h1 className="mb-6 text-lg font-semibold">Contacts</h1>

      {contacts.length === 0 ? (
        <p className="text-slate-500">
          No contacts yet — they&apos;re created automatically when you start a new job.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {contacts.map((contact) => (
            <li key={contact.id} className="p-4">
              <Link href={`/contacts/${contact.id}`} className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{contact.name}</p>
                  <p className="text-sm text-slate-500">{contact.email ?? contact.phone ?? "No contact info"}</p>
                </div>
                <p className="text-sm text-slate-500">
                  {contact._count.jobs} {contact._count.jobs === 1 ? "job" : "jobs"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
