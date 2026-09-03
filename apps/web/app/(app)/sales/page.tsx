import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { SalesLeadForm } from "@/components/SalesLeadForm";
import { SalesLeadRow } from "@/components/SalesLeadRow";

/**
 * Prova's own sales pipeline -- for selling Prova itself, not a tenant's
 * GC/vendor relationships (that's /contacts). Gated on two independent
 * things, neither expressible as a lib/permissions.ts Capability: this
 * Company must be Prova's own operator (Company.isProvaOperator), and this
 * person must be its OWNER. A non-operator company sees nothing distinct
 * from any other page it hasn't been given a link to -- middleware still
 * requires sign-in, but nothing here names what the page would have shown.
 */
export default async function SalesPage() {
  const { company, ...currentUser } = await requireCompanyContext();

  if (!company.isProvaOperator) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="mb-2 text-xl font-semibold text-slate-100">Not part of your access</h1>
        <p className="text-sm text-slate-400">Nothing here for this account.</p>
      </div>
    );
  }

  if (currentUser.role !== "OWNER") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="mb-2 text-xl font-semibold text-slate-100">Owner only</h1>
        <p className="text-sm text-slate-400">
          The sales CRM is restricted to the account owner, same as Team management and billing
          settings.
        </p>
      </div>
    );
  }

  const leads = await prisma.salesLead.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { opportunities: true } } },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-1 text-lg font-semibold text-slate-100">Sales CRM</h1>
      <p className="mb-6 text-sm text-slate-400">
        Prospective Prova customers and the deals in progress with them -- internal, not visible to
        any tenant.
      </p>

      {leads.length === 0 ? (
        <p className="mb-4 text-sm text-slate-400">No leads recorded yet.</p>
      ) : (
        <ul className="mb-4 divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {leads.map((lead) => (
            <SalesLeadRow
              key={lead.id}
              lead={{
                id: lead.id,
                companyName: lead.companyName,
                contactName: lead.contactName,
                email: lead.email,
                phone: lead.phone,
                source: lead.source,
                opportunityCount: lead._count.opportunities,
              }}
            />
          ))}
        </ul>
      )}

      <SalesLeadForm />
    </div>
  );
}
