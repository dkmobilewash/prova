import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { VendorForm } from "@/components/VendorForm";
import { VendorRow } from "@/components/VendorRow";

export default async function VendorsPage() {
  const { company, ...currentUser } = await requireCompanyContext();

  const vendors = await prisma.vendor.findMany({
    where: { companyId: company.id },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Vendors</h1>
      <p className="mb-6 text-sm text-slate-400">
        Suppliers and service vendors you buy from — board and steel suppliers, equipment rental, scaffolding.
        A directory for now; linking vendors to material costs and pricing history comes later.
      </p>

      <div className="mb-8">
        <VendorForm />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Directory</h2>
        {vendors.length === 0 ? (
          <p className="text-slate-400">
            No vendors yet. Add the suppliers you buy from most — board and steel, scaffolding,
            equipment rental — so material costs have a source attached to them.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {vendors.map((vendor) => (
              <VendorRow
                key={vendor.id}
                canDelete={currentUser.role === "OWNER"}
                vendor={{
                  id: vendor.id,
                  name: vendor.name,
                  tradeScope: vendor.tradeScope,
                  contactName: vendor.contactName,
                  phone: vendor.phone,
                  email: vendor.email,
                  notes: vendor.notes,
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
