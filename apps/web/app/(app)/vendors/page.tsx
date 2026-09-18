import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { VendorForm } from "@/components/VendorForm";
import { VendorRow } from "@/components/VendorRow";
import { EmptyState } from "@/components/EmptyState";

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
        <Link href="/vendors/pricing" className="text-link hover:text-link-hover" data-tour="vendors-pricing-link">
          vendor pricing
        </Link>
        .
      </p>

      <div className="mb-8" data-tour="vendors-add">
        <VendorForm />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Directory</h2>
        {vendors.length === 0 ? (
          <EmptyState
            data-tour="vendors-empty"
            title="No vendors yet"
            purpose={
              <p>
                The suppliers you buy from — the lumber yard, the tile shop, the equipment rental
                place — with who to call and what they carry. Once they are here, material orders
                and price quotes can say where things came from.
              </p>
            }
            actions={[
              { label: "Add a vendor", opens: "vendors-add" },
              { label: "See vendor pricing", href: "/vendors/pricing" },
            ]}
            example={{
              rows: [
                { title: "Valley Lumber Supply", tag: "Lumber", detail: "Sam · (555) 010-4455", meta: "orders@example.com" },
                { title: "Main St. Tile & Stone", tag: "Tile", detail: "Front counter · (555) 010-7788" },
                { title: "Ridge Equipment Rental", tag: "Rental", detail: "Lifts, dumpsters, scaffolding" },
              ],
            }}
          />
        ) : (
          <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface" data-tour="vendors-list">
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
