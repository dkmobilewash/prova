import Link from "next/link";
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
      <h1 className="mb-2 text-xl font-semibold text-ink">Vendors</h1>
      <p className="mb-6 text-sm text-ink-body">
        Suppliers and service vendors you buy from — board and steel suppliers, equipment rental, scaffolding.
        What each of them has quoted, and which way those prices are moving, is on{" "}
        <Link href="/vendors/pricing" className="text-link hover:text-link-hover">
          vendor pricing
        </Link>
        .
      </p>

      <div className="mb-8">
        <VendorForm />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Directory</h2>
        {vendors.length === 0 ? (
          <p className="text-ink-body">
            No vendors yet. Add the suppliers you buy from most — board and steel, scaffolding,
            equipment rental — so material costs have a source attached to them.
          </p>
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
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
