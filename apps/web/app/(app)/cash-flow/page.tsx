import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
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
  const { context, allowed } = await requireCapability("VIEW_COMPANY_FINANCIALS");
  if (!allowed) return <NoAccess capability="VIEW_COMPANY_FINANCIALS" />;
  const { company } = context;

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

  // EVERY FIGURE ON THIS PAGE IS DERIVED FROM AN INVOICE, so an account
  // that has raised none has nothing to say — and said it in 28 separate
  // instances of $0.00, five amber aging buckets reading as overdue, and a
  // seven-row forecast of zeros, because `calculateCashFlowForecast` seeds
  // its months unconditionally and this page mapped them with no length
  // check. Measured on an empty account, not estimated.
  //
  // Retainage needs no separate test here: it is withheld ON invoices
  // (`invoiceRetainageWithheld` above is read from `job.invoices`), so no
  // invoice means no retainage balance to miss.
  const hasAnyInvoice = jobs.some((job) => job.invoices.length > 0);

  // The all-paid account is a SECOND zero state, and a real answer rather
  // than an absence: five zero buckets in amber tell a contractor who is
  // owed nothing that they are behind. Both of these guard "there is
  // nothing at all", so an account with money outstanding renders exactly
  // as it did before.
  const forecastHasMoney = forecast.months.some(
    (month) => month.arExpected > 0 || month.retainageExpected > 0,
  );

  if (!hasAnyInvoice) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="mb-1 text-xl font-semibold text-slate-100">Cash flow forecast</h1>
        <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900 p-6">
          <p className="text-slate-300">
            {jobs.length === 0
              ? "No jobs yet, and every figure on this page is worked out from an invoice against one."
              : "No invoices raised yet, so there is nothing outstanding to age and nothing to forecast."}
          </p>
          <p className="mt-3 max-w-2xl text-sm text-slate-400">
            Once you bill a job this page shows three things: what each GC still owes and how many days
            past due it is, retainage being held back until substantial completion, and a month-by-month
            projection of when that money should land. Every date comes from the invoice, the GC&apos;s
            payment terms, or a substantial completion date already on file — nothing here is a
            statistical guess, and an amount with no such date is reported as unscheduled rather than
            being assigned a month it might not arrive in.
          </p>
          {jobs.length === 0 ? (
            <Link
              href="/jobs/new"
              className="mt-4 inline-flex min-h-11 items-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500"
            >
              Create a job
            </Link>
          ) : (
            <p className="mt-4 text-sm text-slate-400">
              Invoices are raised on the job they bill, in its Billing section.{" "}
              <Link href="/jobs" className="text-blue-400 hover:text-blue-300">
                Open a job
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="mb-1 text-xl font-semibold text-slate-100">Cash flow forecast</h1>
      <p className="mb-6 max-w-2xl text-sm text-slate-500">
        What each GC owes you by how long it has been owed (AR aging), retainage receivable, and a forward monthly projection built
        strictly from due dates, payment terms, and substantial completion dates already on file — nothing here is a
        statistical guess. Amounts with no such date land in an explicit unscheduled total rather than being assigned
        one.
      </p>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Accounts receivable aging</h2>
        {/* The grid and the total only appear when something is outstanding.
            An account that has been paid in full does not need five zeros
            and a "Total outstanding: $0.00" to say so — the sentence below
            says it, and says it as the good news it is. */}
        {sortedInvoices.length > 0 && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 sm:grid-cols-5">
              {(Object.keys(AGING_BUCKET_LABELS) as ArAgingBucket[]).map((bucket) => (
                <div key={bucket}>
                  <p className="text-xs text-slate-500">{AGING_BUCKET_LABELS[bucket]}</p>
                  {/* Amber is a warning, and zero is not one. An empty
                      bucket beside a full one was still being coloured as
                      though it were late. */}
                  <p
                    className={
                      bucket === "CURRENT" || agingSummary.byBucket[bucket] === 0
                        ? "text-slate-100"
                        : "text-amber-400"
                    }
                  >
                    {money(agingSummary.byBucket[bucket])}
                  </p>
                </div>
              ))}
            </div>
            <p className="mb-3 text-sm text-slate-400">
              Total outstanding: {money(agingSummary.totalOutstanding)}
            </p>
          </>
        )}

        {sortedInvoices.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing outstanding — every invoice raised has been paid in full.
          </p>
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
        {/* Same rule as the aging total above: a zero total is stated once,
            by the sentence, instead of twice. */}
        {retainageWithBalance.length > 0 && (
          <p className="mb-3 text-sm text-slate-400">
            Total outstanding: {money(forecast.totalRetainageOutstanding)}
            {forecast.retainageNoTargetDate > 0 && (
              <> · {money(forecast.retainageNoTargetDate)} with no substantial completion date set, so no forecast month</>
            )}
          </p>
        )}
        {retainageWithBalance.length === 0 ? (
          <p className="text-sm text-slate-500">
            No retainage being held. Anything withheld on an invoice shows up here until it is released.
          </p>
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
        {/* `calculateCashFlowForecast` seeds Overdue plus every month in the
            window whether or not anything lands in them — deliberately, so
            the table has a stable shape. That makes the length of
            `forecast.months` useless as a "is there anything here" test: it
            is seven either way. The money is what has to be checked. */}
        {!forecastHasMoney ? (
          <p className="text-sm text-slate-500">
            Nothing to project. Every invoice is paid and no retainage is being held, so there is no
            money with a date on it to put in a month.
          </p>
        ) : (
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
        )}
      </section>
    </div>
  );
}
