import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { money } from "@/lib/money";
import { calculateRetainageSummary } from "@/lib/retainage";
import {
  calculateArAgingInvoice,
  calculateCashFlowForecast,
  summarizeArAging,
  type ArAgingBucket,
  type RetainageReceivableInput,
} from "@/lib/cash-flow";

const AGING_BUCKET_LABELS: Record<ArAgingBucket, string> = {
  CURRENT: "Current",
  DAYS_1_30: "1–30 days",
  DAYS_31_60: "31–60 days",
  DAYS_61_90: "61–90 days",
  DAYS_90_PLUS: "90+ days",
};

const FORECAST_MONTHS_AHEAD = 6;

export default async function CashFlowPage() {
  const { company } = await requireCompanyContext();

  const jobs = await prisma.job.findMany({
    where: { companyId: company.id },
    include: {
      contact: true,
      invoices: { include: { payments: true } },
      retainageReleases: true,
    },
  });

  const asOf = new Date();

  const arInvoices = jobs
    .flatMap((job) =>
      job.invoices.map((invoice) => {
        const paidAmount = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        return calculateArAgingInvoice(
          {
            invoiceId: invoice.id,
            jobId: job.id,
            jobName: job.name,
            contactName: job.contact.name,
            amount: Number(invoice.amount),
            paidAmount,
            issuedAt: invoice.issuedAt,
            dueAt: invoice.dueAt,
            paymentTermsDays: job.contact.paymentTermsDays,
          },
          asOf,
        );
      }),
    )
    .filter((row) => row != null);

  const retainageByJob: RetainageReceivableInput[] = jobs.map((job) => {
    const summary = calculateRetainageSummary({
      invoiceRetainageWithheld: job.invoices.map((inv) => (inv.retainageWithheld != null ? Number(inv.retainageWithheld) : null)),
      releaseAmounts: job.retainageReleases.map((r) => Number(r.amount)),
      substantialCompletionDate: job.substantialCompletionDate,
    });
    return {
      jobId: job.id,
      jobName: job.name,
      outstandingBalance: summary.balance,
      substantialCompletionDate: summary.substantialCompletionDate,
    };
  });

  const agingSummary = summarizeArAging(arInvoices);
  const forecast = calculateCashFlowForecast(arInvoices, retainageByJob, asOf, FORECAST_MONTHS_AHEAD);

  const sortedInvoices = [...arInvoices].sort((a, b) => b.daysPastDue - a.daysPastDue);
  const retainageWithBalance = retainageByJob.filter((job) => job.outstandingBalance > 0);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-1 text-xl font-semibold text-slate-100">Cash flow forecast</h1>
      <p className="mb-6 max-w-2xl text-sm text-slate-500">
        AR aging on outstanding invoice balances, retainage receivable, and a forward monthly projection built
        strictly from due dates, payment terms, and substantial completion dates already on file — nothing here is a
        statistical guess. Amounts with no such date land in an explicit unscheduled total rather than being assigned
        one.
      </p>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Accounts receivable aging</h2>
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 sm:grid-cols-5">
          {(Object.keys(AGING_BUCKET_LABELS) as ArAgingBucket[]).map((bucket) => (
            <div key={bucket}>
              <p className="text-xs text-slate-500">{AGING_BUCKET_LABELS[bucket]}</p>
              <p className={bucket === "CURRENT" ? "text-slate-100" : "text-amber-400"}>
                {money(agingSummary.byBucket[bucket])}
              </p>
            </div>
          ))}
        </div>
        <p className="mb-3 text-sm text-slate-400">Total outstanding: {money(agingSummary.totalOutstanding)}</p>

        {sortedInvoices.length === 0 ? (
          <p className="text-sm text-slate-500">No outstanding invoice balances.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="pb-1 pr-3 font-normal">Job</th>
                  <th className="pb-1 pr-3 font-normal">GC</th>
                  <th className="pb-1 pr-3 text-right font-normal">Balance</th>
                  <th className="pb-1 pr-3 text-right font-normal">Due</th>
                  <th className="pb-1 text-right font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedInvoices.map((row) => (
                  <tr key={row.invoiceId} className="border-t border-slate-800">
                    <td className="py-1 pr-3 text-slate-300">{row.jobName}</td>
                    <td className="py-1 pr-3 text-slate-400">{row.contactName}</td>
                    <td className="py-1 pr-3 text-right text-slate-100">{money(row.balance)}</td>
                    <td className="py-1 pr-3 text-right text-slate-400">
                      {row.effectiveDueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                    </td>
                    <td className="py-1 text-right">
                      <span className={row.bucket === "CURRENT" ? "text-slate-400" : "text-amber-400"}>
                        {row.bucket === "CURRENT" ? "Current" : `${row.daysPastDue}d overdue`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Retainage receivable</h2>
        <p className="mb-3 text-sm text-slate-400">
          Total outstanding: {money(forecast.totalRetainageOutstanding)}
          {forecast.retainageNoTargetDate > 0 && (
            <> · {money(forecast.retainageNoTargetDate)} with no substantial completion date set, so no forecast month</>
          )}
        </p>
        {retainageWithBalance.length === 0 ? (
          <p className="text-sm text-slate-500">No outstanding retainage.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {retainageWithBalance.map((job) => (
              <li key={job.jobId} className="flex items-center justify-between border-t border-slate-800 py-1">
                <span className="text-slate-300">{job.jobName}</span>
                <span className="text-slate-100">
                  {money(job.outstandingBalance)}
                  {job.substantialCompletionDate && (
                    <span className="ml-2 text-xs text-slate-500">
                      expected around{" "}
                      {job.substantialCompletionDate.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Forecast, next {FORECAST_MONTHS_AHEAD} months</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="pb-1 pr-3 font-normal">Month</th>
                <th className="pb-1 pr-3 text-right font-normal">AR expected</th>
                <th className="pb-1 pr-3 text-right font-normal">Retainage expected</th>
                <th className="pb-1 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {forecast.months.map((month) => (
                <tr key={month.key} className="border-t border-slate-800">
                  <td className={`py-1 pr-3 ${month.key === "OVERDUE" ? "text-amber-400" : "text-slate-300"}`}>
                    {month.label}
                  </td>
                  <td className="py-1 pr-3 text-right text-slate-400">{money(month.arExpected)}</td>
                  <td className="py-1 pr-3 text-right text-slate-400">{money(month.retainageExpected)}</td>
                  <td className="py-1 text-right text-slate-100">
                    {money(month.arExpected + month.retainageExpected)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
