import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PrintButton } from "@/components/PrintButton";
import { money } from "@/lib/money";
import { loadPayApplication } from "@/lib/pay-application-query";

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

  const view = await loadPayApplication(id, invoiceId, company.id);
  if (!view) {
    notFound();
  }
  const { job, invoice, isPayApplication, lineItems: lineItemResults, summary } = view;

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
