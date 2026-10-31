import { PageShell } from "@prova/ui";
import { prisma } from "@prova/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { NoAccess } from "@/components/NoAccess";
import { BuyoutRow, PurchaseOrderActions, PurchaseOrderLineRow } from "@/components/BuyoutRow";
import { party } from "@/lib/billing/g702";
import { formatCalendarDate } from "@/lib/render-date";
import { requireCapability } from "@/lib/authz";
import { money } from "@/lib/money";
import { viewerToday } from "@/lib/viewerToday";
import { buyoutRows, poLineAmount } from "@/lib/purchase-orders";
import { loadLineCommitments } from "@/lib/purchase-orders-query";
import type { CostCategory } from "@/lib/cost-category";

/**
 * Buyout: each scope line's budget beside the vendor quotes on file, and the
 * draft purchase orders made from them. VIEW_JOB_COSTS, the gate on the
 * Estimate tab that links here, because this page is budgets and prices.
 */
export default async function BuyoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return <NoAccess capability="VIEW_JOB_COSTS" />;
  const { company } = context;

  const job = await prisma.job.findFirst({
    where: { id, companyId: company.id },
    select: {
      id: true,
      name: true,
      status: true,
      contractNumber: true,
      projectLocation: true,
      siteAddress: true,
      lineItems: {
        where: { isDeleted: false },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          description: true,
          unit: true,
          quantity: true,
          budgetedUnitCost: true,
          costCategory: true,
          sourceCatalogEntryId: true,
        },
      },
    },
  });
  if (!job) notFound();

  const [commitments, quotes, vendors, purchaseOrders, today] = await Promise.all([
    loadLineCommitments(job.id),
    prisma.vendorPriceQuote.findMany({
      where: { companyId: company.id, catalogEntryId: { not: null } },
      include: { vendor: { select: { name: true } } },
    }),
    prisma.vendor.findMany({ where: { companyId: company.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.purchaseOrder.findMany({
      where: { jobId: job.id },
      orderBy: { number: "asc" },
      include: {
        vendor: { select: { name: true, contactName: true, phone: true, email: true } },
        lines: { orderBy: { createdAt: "asc" } },
      },
    }),
    viewerToday(),
  ]);

  const rows = buyoutRows(
    job.lineItems.map((item) => ({
      id: item.id,
      description: item.description,
      unit: item.unit,
      quantity: Number(item.quantity),
      budgetedUnitCost: item.budgetedUnitCost == null ? null : Number(item.budgetedUnitCost),
      costCategory: item.costCategory as CostCategory | null,
      catalogEntryId: item.sourceCatalogEntryId,
    })),
    quotes.map((quote) => ({
      id: quote.id,
      vendorId: quote.vendorId,
      vendorName: quote.vendor.name,
      catalogEntryId: quote.catalogEntryId,
      description: quote.description,
      unit: quote.unit,
      unitPrice: Number(quote.unitPrice),
      quotedOn: quote.quotedOn.toISOString().slice(0, 10),
      validUntil: quote.validUntil ? quote.validUntil.toISOString().slice(0, 10) : null,
      source: quote.source,
      notes: quote.notes,
    })),
    commitments,
    today,
  );

  return (
    <PageShell width="working">
      <PageHeader
        route="/dashboard"
        parent={[
          { href: `/jobs/${job.id}`, label: job.name },
          { href: `/jobs/${job.id}/estimate`, label: "Estimate" },
        ]}
        title="Buyout"
      />
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">
        Each line&rsquo;s budget beside the quotes on file. Quotes match a line through the catalog item it came from.
        Drafted is not committed, and committed is shown beside your actual cost, never added to it.
      </p>

      {job.status === "ESTIMATE" ? (
        <p className="mt-6 text-sm text-ink-muted">This job is still an estimate. Buyout opens once it is contracted.</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="mt-6 text-sm text-ink-muted">
              No lines to buy out. Labor lines are your own crew, so they are not listed here.
            </p>
          ) : (
            <ul className="mt-6 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
              {rows.map((row) => (
                <BuyoutRow key={row.line.id} jobId={job.id} row={row} vendors={vendors} />
              ))}
            </ul>
          )}

          <h2 className="mt-8 text-sm font-semibold text-ink-label">Purchase orders</h2>
          {purchaseOrders.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">None yet. Adding a line above starts a draft for that vendor.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-3">
              {purchaseOrders.map((po) => {
                const total = po.lines.reduce(
                  (sum, line) => sum + poLineAmount({ quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) }),
                  0,
                );
                return (
                  <li key={po.id} className="rounded-lg border border-line-card bg-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm text-ink">
                        PO {po.number} · {po.vendor.name} · {po.status.toLowerCase()} · {money(total)}
                        {po.issuedOn ? ` · issued ${formatCalendarDate(po.issuedOn)}` : ""}
                        {po.closedOn ? ` · closed ${formatCalendarDate(po.closedOn)}` : ""}
                      </p>
                      <PurchaseOrderActions
                        id={po.id}
                        status={po.status}
                        today={today}
                        document={{
                          number: po.number,
                          status: po.status,
                          issuedOn: po.issuedOn ? formatCalendarDate(po.issuedOn) : null,
                          from: party(
                            company.dbaName ? `${company.name} (dba ${company.dbaName})` : company.name,
                            company.hqAddressLine1,
                            company.hqAddressLine2,
                            [company.hqCity, company.hqState, company.hqZip].filter(Boolean).join(" ") || null,
                            company.phone,
                          ),
                          vendor: party(po.vendor.name, po.vendor.contactName, po.vendor.phone, po.vendor.email),
                          jobName: job.name,
                          shipTo: job.siteAddress ?? job.projectLocation ?? null,
                          contractNumber: job.contractNumber,
                          lines: po.lines.map((line) => ({
                            description: line.description,
                            quantity: Number(line.quantity),
                            unit: line.unit,
                            unitPrice: Number(line.unitPrice),
                          })),
                        }}
                      />
                    </div>
                    <ul className="mt-2 flex flex-col gap-1">
                      {po.lines.map((line) => (
                        <PurchaseOrderLineRow
                          key={line.id}
                          canRemove={po.status === "DRAFT"}
                          line={{
                            id: line.id,
                            text: `${line.description}: ${Number(line.quantity)}${line.unit ? ` ${line.unit}` : ""} at ${money(Number(line.unitPrice))}`,
                          }}
                        />
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </PageShell>
  );
}
