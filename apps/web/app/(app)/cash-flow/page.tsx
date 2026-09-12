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
import { can } from "@/lib/permissions";
import { loadWipSchedule } from "@/lib/wip-schedule-query";
import { WIP_SCHEDULE_COLUMNS } from "@/lib/wip-schedule";

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

  // The WIP schedule is company-wide job cost and margin, so the page's own
  // VIEW_COMPANY_FINANCIALS is necessary and not sufficient — /api/export/
  // wip-schedule asks for VIEW_JOB_COSTS as well, and the section is withheld
  // here on the same pair rather than advertising a download that 403s.
  const showsWipSchedule = can(context, "VIEW_JOB_COSTS");
  const wipSchedule = showsWipSchedule ? await loadWipSchedule(company.id) : null;
  // Notes live under the table rather than in it: they are whole sentences,
  // and an 18th column of prose makes the other seventeen unreadable. The CSV
  // carries them as a Notes column, which is said on screen below.
  const wipColumns = WIP_SCHEDULE_COLUMNS.filter((column) => column.key !== "notes");

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

      {/* The document a surety underwriter and a CPA ask for. It lives here,
          on the company-money page, rather than on /jobs/[id]: a WIP schedule
          is one row per job across the whole book, and there is no single job
          it belongs to. Every figure is composed from lib/wip.ts and
          lib/company-financials.ts — the same functions /jobs/[id] renders —
          so a row here and that job's own screen can never print two
          different numbers. */}
      {wipSchedule && (
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">WIP schedule</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Percentage-of-completion, cost-to-cost — the format a surety underwriter and a CPA
              ask for. Contracted and in-progress jobs, which is the same population the backlog
              figure on the bar below is summed over, so the two contract-value totals agree. A
              figure this data cannot establish is left blank and says why underneath rather than
              being estimated.
            </p>
          </div>
          <a
            href="/api/export/wip-schedule"
            className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Download CSV
          </a>
        </div>

        {wipSchedule.rows.length === 0 ? (
          <p className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">
            No contracted or in-progress jobs, so there is no work in progress to schedule. The
            download still works and gives you the column headings and an empty total row — an
            empty book is a fact, not a failed export.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1400px] text-left text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  {wipColumns.map((column) => (
                    <th
                      key={column.key}
                      className={`pb-1 pr-3 font-normal ${column.kind === "text" ? "" : "text-right"}`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wipSchedule.rows.map((row) => (
                  <tr key={row.jobId} className="border-t border-slate-800">
                    {wipColumns.map((column) => {
                      const value = column.value(row);
                      return (
                        <td
                          key={column.key}
                          className={`py-1 pr-3 ${
                            column.kind === "text" ? "text-slate-300" : "text-right text-slate-100"
                          }`}
                        >
                          {/* An em dash, never a zero: a refused figure and a
                              figure that happens to be zero are different
                              facts, and printing $0 for the first is the
                              invented number this whole file refuses to
                              write. */}
                          {value === null || value === undefined
                            ? "—"
                            : column.kind === "money"
                              ? money(value as number)
                              : String(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-700 font-medium">
                  {wipColumns.map((column) => {
                    const value = column.total(wipSchedule.totals);
                    return (
                      <td
                        key={column.key}
                        className={`py-2 pr-3 ${
                          column.kind === "text" ? "text-slate-200" : "text-right text-slate-100"
                        }`}
                      >
                        {value === null || value === undefined
                          ? "—"
                          : column.kind === "money"
                            ? money(value as number)
                            : String(value)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* The honesty channel, and the reason a blank cell above is a
            statement rather than a bug. Every sentence here is derived, not
            written: it names the threshold that was missed and the figure
            that was therefore withheld. */}
        {wipSchedule.rows.length > 0 && (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-300">
              What this schedule does not state, and why
            </h3>
            <ul className="flex flex-col gap-2 text-xs text-slate-500">
              {wipSchedule.rows
                .filter((row) => row.notes.length > 0)
                .map((row) => (
                  <li key={row.jobId}>
                    <span className="text-slate-400">{row.jobName}.</span> {row.notes.join(" ")}
                  </li>
                ))}
              <li>
                <span className="text-slate-400">Total row.</span>{" "}
                {wipSchedule.totals.notes.join(" ")}
              </li>
            </ul>
            <p className="mt-3 text-xs text-slate-600">
              The CSV carries every one of these in a Notes column on the row it belongs to, so the
              file you send out says the same things this screen does.
            </p>
          </div>
        )}
      </section>
      )}
    </div>
  );
}
