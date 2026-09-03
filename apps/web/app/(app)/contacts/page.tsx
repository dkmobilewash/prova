import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { ContactForm } from "@/components/ContactForm";
import { ContactRow } from "@/components/ContactRow";

export default async function ContactsPage() {
  const { company, ...currentUser } = await requireCompanyContext();

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
      <h1 className="mb-6 text-xl font-semibold text-slate-100">Contacts</h1>

      <div className="mb-6">
        <ContactForm />
      </div>

      {contacts.length === 0 ? (
        <p className="text-slate-400">No contacts yet — add the first GC, developer, or vendor you&apos;re talking to.</p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {contacts.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={{
                id: contact.id,
                name: contact.name,
                email: contact.email,
                phone: contact.phone,
                status: contact.status,
                accountType: contact.accountType,
                jobCount: contact._count.jobs,
                openBidCount: contact._count.bidInvitations,
              }}
              canDelete={currentUser.role === "OWNER"}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
