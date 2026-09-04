import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PrintButton } from "@/components/PrintButton";
import { money } from "@/lib/money";
import { calculatePayAppLineItem, calculatePayAppSummary, type PayAppLineItemResult } from "@/lib/pay-application";

function percent(value: number | null) {
  return value != null ? `${(value * 100).toFixed(1)}%` : "—";
}

export default async function PayApplicationPage({
  params,
}: {
  params: Promise<{ id: string; invoiceId: string }>;
}) {
  const { id, invoiceId } = await params;
  // The job page withholds its billing SECTIONS from anyone without
  // MANAGE_BILLING; this is the same document on its own URL, so it has
  // to answer the same way or the withholding upstairs means nothing.
  const { context, allowed } = await requireCapability("MANAGE_BILLING");
  if (!allowed) return <NoAccess capability="MANAGE_BILLING" />;
  const { company } = context;

  const job = await prisma.job.findUnique({
    where: { id },
    include: {
      contact: true,
      lineItems: true,
      invoices: {
        orderBy: { number: "asc" },
        include: { lineItems: true },
      },
    },
  });
  if (!job || job.companyId !== company.id) {
    notFound();
  }

  const invoice = job.invoices.find((inv) => inv.id === invoiceId);
  if (!invoice) {
    notFound();
  }

  const isPayApplication = invoice.lineItems.length > 0;
  const earlierInvoices = job.invoices.filter((inv) => inv.number < invoice.number);

  // Every line item this application should show a row for: everything
  // currently on the SOV, plus anything billed on an earlier or later
  // invoice for this job even if it was since removed by a change order —
  // a removed line's final balance still belongs on the record.
  const lineItemIds = new Set<string>(job.lineItems.map((item) => item.id));
  for (const inv of job.invoices) {
    for (const row of inv.lineItems) {
      lineItemIds.add(row.lineItemId);
    }
  }

  const lineItemById = new Map(job.lineItems.map((item) => [item.id, item]));

  const lineItemResults: PayAppLineItemResult[] = [...lineItemIds]
    .map((lineItemId) => {
      const lineItem = lineItemById.get(lineItemId);
      const scheduledValue = lineItem ? Number(lineItem.quantity) * Number(lineItem.unitPrice ?? 0) : 0;
      const previousBilled = earlierInvoices.reduce(
        (sum, inv) => sum + Number(inv.lineItems.find((r) => r.lineItemId === lineItemId)?.thisPeriodBilled ?? 0),
        0,
      );
      // materialsStoredValue is a per-period delta, not a running balance —
      // summed across every earlier invoice the same way previousBilled is,
      // or a line's stored materials from an earlier application vanish
      // from the total the moment a later application doesn't re-enter them.
      const previousMaterialsStored = earlierInvoices.reduce(
        (sum, inv) =>
          sum + Number(inv.lineItems.find((r) => r.lineItemId === lineItemId)?.materialsStoredValue ?? 0),
        0,
      );
      const thisRow = invoice.lineItems.find((r) => r.lineItemId === lineItemId);

      return {
        lineItemId,
        description: lineItem?.description ?? "(line item removed)",
        scheduledValue,
        previousBilled,
        thisPeriodBilled: Number(thisRow?.thisPeriodBilled ?? 0),
        previousMaterialsStored,
        materialsStoredValue: Number(thisRow?.materialsStoredValue ?? 0),
      };
    })
    // Drop untouched, zero-value rows for lines that were never billed and
    // aren't in this period's application — an all-zero row for every SOV
    // line on every application would bury the ones that actually moved.
    .filter(
      (row) =>
        row.scheduledValue > 0 ||
        row.previousBilled > 0 ||
        row.thisPeriodBilled > 0 ||
        row.previousMaterialsStored > 0 ||
        row.materialsStoredValue > 0,
    )
    .map(calculatePayAppLineItem);

  const summary = calculatePayAppSummary({
    lineItems: lineItemResults,
    retainagePercent: job.retainagePercent != null ? Number(job.retainagePercent) : null,
    previousRetainageWithheld: earlierInvoices.reduce((sum, inv) => sum + Number(inv.retainageWithheld ?? 0), 0),
    thisPeriodRetainageWithheld: Number(invoice.retainageWithheld ?? 0),
  });

  return (
    <div className="mx-auto max-w-4xl p-6 print:p-0">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/jobs/${job.id}`} className="text-sm text-blue-400 hover:underline">
          ← Back to job
        </Link>
        <PrintButton />
      </div>

      <h1 className="text-xl font-semibold text-slate-100">
        Application for payment #{invoice.number} — {job.name}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {job.contact.name} · {invoice.issuedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        {invoice.description ? ` · ${invoice.description}` : ""}
      </p>
      <p className="mt-3 max-w-2xl text-xs text-slate-500">
        This is a G702/G703-style summary and continuation sheet built from this job&rsquo;s schedule of values — it is
        not formatted as the AIA G702/G703 forms themselves.
      </p>

      {!isPayApplication ? (
        <p className="mt-8 text-sm text-slate-500">
          This invoice wasn&rsquo;t submitted as a pay application — it was created as a simple lump-sum bill, so
          there&rsquo;s no per-line-item breakdown to show. Submit a pay application from the job page to get a
          continuation sheet like this one.
        </p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-slate-500">Contract sum to date</p>
              <p className="text-slate-100">{money(summary.contractSumToDate)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Total completed &amp; stored to date</p>
              <p className="text-slate-100">{money(summary.totalCompletedAndStoredToDate)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Retainage to date</p>
              <p className="text-slate-100">{money(summary.retainageToDate)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Total earned less retainage</p>
              <p className="text-slate-100">{money(summary.totalEarnedLessRetainage)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Less previous certificates for payment</p>
              <p className="text-slate-100">{money(summary.previousCertificatesForPayment)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Current payment due</p>
              <p className="font-medium text-green-400">{money(summary.currentPaymentDue)}</p>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <p className="text-xs text-slate-500">Balance to finish, including retainage</p>
              <p className="text-slate-100">{money(summary.balanceToFinishIncludingRetainage)}</p>
            </div>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="pb-1 pr-3 font-normal">Line item</th>
                  <th className="pb-1 pr-3 text-right font-normal">Scheduled value</th>
                  <th className="pb-1 pr-3 text-right font-normal">Previous</th>
                  <th className="pb-1 pr-3 text-right font-normal">This period</th>
                  <th className="pb-1 pr-3 text-right font-normal">Materials stored to date</th>
                  <th className="pb-1 pr-3 text-right font-normal">Total to date</th>
                  <th className="pb-1 pr-3 text-right font-normal">%</th>
                  <th className="pb-1 text-right font-normal">Balance to finish</th>
                </tr>
              </thead>
              <tbody>
                {lineItemResults.map((row) => (
                  <tr key={row.lineItemId} className="border-t border-slate-800">
                    <td className="py-1 pr-3 text-slate-300">{row.description}</td>
                    <td className="py-1 pr-3 text-right text-slate-400">{money(row.scheduledValue)}</td>
                    <td className="py-1 pr-3 text-right text-slate-400">{money(row.previousBilled)}</td>
                    <td className="py-1 pr-3 text-right text-slate-100">{money(row.thisPeriodBilled)}</td>
                    <td className="py-1 pr-3 text-right text-slate-400">{money(row.materialsStoredToDate)}</td>
                    <td className="py-1 pr-3 text-right text-slate-100">{money(row.totalCompletedAndStoredToDate)}</td>
                    <td className="py-1 pr-3 text-right text-slate-400">{percent(row.percentOfScheduledValue)}</td>
                    <td className="py-1 text-right text-slate-400">{money(row.balanceToFinish)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
