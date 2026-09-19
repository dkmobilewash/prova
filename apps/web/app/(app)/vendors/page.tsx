import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { VendorForm } from "@/components/VendorForm";
import { VendorRow } from "@/components/VendorRow";
import { can } from "@/lib/permissions";
import { coiStandingFor, coiStandingLine, governingCois } from "@/lib/coi-standing";
import { serverToday } from "@/lib/serverToday";
import { EmptyState } from "@/components/EmptyState";

export default async function VendorsPage() {
  const context = await requireCompanyContext();
  const { company, ...currentUser } = context;
  // Insurance standing is a summary of compliance records, so it is shown
  // only to someone who could open /compliance — the same rule an alert
  // follows (ALERT_CAPABILITY).
  const showCoi = can(context, "MANAGE_COMPLIANCE");

  const [vendors, certificates] = await Promise.all([
    prisma.vendor.findMany({
      where: { companyId: company.id },
      orderBy: { name: "asc" },
    }),
    showCoi
      ? prisma.complianceDocument.findMany({
          where: { companyId: company.id, type: "CERTIFICATE_OF_INSURANCE" },
          select: { id: true, partyName: true, jobId: true, coverageType: true, expiresAt: true },
        })
      : Promise.resolve([]),
  ]);
  // Derived per render from the dates, never stored. Renewed lines drop out
  // first, exactly as they do from the alerts.
  const governing = governingCois(certificates);
  const today = serverToday();

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
        {showCoi && (
          <p className="mb-3 text-xs text-ink-body" data-tour="vendors-coi">
            Each vendor shows its certificate of insurance, matched by name to the certificates on{" "}
            <Link href="/compliance" className="text-link hover:text-link-hover">
              Compliance
            </Link>
            {currentUser.role === "OWNER" && (
              <>
                {" "}— or{" "}
                <Link href="/settings/import#mycoi" className="text-link hover:text-link-hover">
                  import them from myCOI
                </Link>
              </>
            )}
            .
          </p>
        )}
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
                coi={showCoi ? coiStandingLine(coiStandingFor(vendor.name, governing, today), today) : undefined}
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
