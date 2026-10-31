import { PageShell } from "@prova/ui";
import { prisma } from "@prova/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { NoAccess } from "@/components/NoAccess";
import { BuyoutRow, PurchaseOrderActions, PurchaseOrderLineRow, SpecFindingList } from "@/components/BuyoutRow";
import { buyoutSpecCheck, specCheckSentence } from "@/lib/buyout-spec-check";
import { loadJobSpecFindings } from "@/lib/buyout-spec-query";
import { formatCalendarDate } from "@/lib/render-date";
import { requireCapability } from "@/lib/authz";
import { SendDocument, SendHistory } from "@/components/SendDocument";
import { purchaseOrderEmail } from "@/lib/document-email";
import { purchaseOrderDocument } from "@/lib/purchase-order-document";
import { purchaseOrderFileName } from "@/lib/purchase-order-pdf";
import { loadSends } from "@/lib/sent-documents-query";
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
          tradeScope: true,
          sourceCatalogEntryId: true,
        },
      },
    },
  });
  if (!job) notFound();

  const [commitments, quotes, vendors, purchaseOrders, today, specSections] = await Promise.all([
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
    loadJobSpecFindings(job.id, company.id),
  ]);

  const sends = await loadSends(company.id, "PURCHASE_ORDER", purchaseOrders.map((po) => po.id));

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

  const specCheck = buyoutSpecCheck(
    rows.map((row) => ({
      id: row.line.id,
      tradeScope: job.lineItems.find((item) => item.id === row.line.id)?.tradeScope ?? null,
    })),
    specSections,
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
          <div className="mt-6 flex flex-col gap-2">
            <p className="text-sm text-ink-muted">{specCheckSentence(specCheck)}</p>
            {specCheck.unplaced.length > 0 && (
              <SpecFindingList
                findings={specCheck.unplaced}
                summary={`Spec says, not tied to one line · ${specCheck.unplaced.length}`}
              />
            )}
          </div>

          {rows.length === 0 ? (
            <p className="mt-6 text-sm text-ink-muted">
              No lines to buy out. Labor lines are your own crew, so they are not listed here.
            </p>
          ) : (
            <ul className="mt-6 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
              {rows.map((row) => (
                <BuyoutRow
                  key={row.line.id}
                  jobId={job.id}
                  row={row}
                  vendors={vendors}
                  findings={specCheck.byLine.get(row.line.id)}
                />
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
                const document = purchaseOrderDocument(po, job, company);
                return (
                  <li key={po.id} className="rounded-lg border border-line-card bg-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm text-ink">
                        PO {po.number} · {po.vendor.name} · {po.status.toLowerCase()} · {money(total)}
                        {po.issuedOn ? ` · issued ${formatCalendarDate(po.issuedOn)}` : ""}
                        {po.closedOn ? ` · closed ${formatCalendarDate(po.closedOn)}` : ""}
                      </p>
                      <PurchaseOrderActions id={po.id} status={po.status} document={document} />
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
                    <div className="mt-3 flex flex-col items-start gap-2">
                      <SendHistory sends={sends.get(po.id) ?? []} />
                      {po.status !== "DRAFT" && (
                        <SendDocument
                          target={{ kind: "PURCHASE_ORDER", id: po.id }}
                          draft={purchaseOrderEmail({
                            company: company.dbaName ?? company.name,
                            jobName: job.name,
                            number: po.number,
                            total: money(total),
                            fileName: purchaseOrderFileName(document),
                            vendorName: po.vendor.name,
                            vendorEmail: po.vendor.email,
                          })}
                        />
                      )}
                    </div>
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
