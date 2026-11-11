import Link from "next/link";
import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
import { requireCompanyContext } from "@/lib/auth";
import { formatInstant } from "@/lib/render-date";
import { viewerTimeZone } from "@/lib/viewerToday";
import { WINDOW_DAYS, formatElapsed, loadPilotMetrics } from "@/lib/internal/pilotMetrics";

export const metadata = { title: "Pilots" };

/**
 * ── PILOTS: HOW EACH CUSTOMER COMPANY IS USING THE PRODUCT ──
 *
 * GATED EXACTLY AS /internal/usage AND /sales ARE: this Company must be Prova's
 * own operator (Company.isProvaOperator) AND the person its OWNER. It reads across
 * companies, so nothing narrower would be honest, and a tenant sees the same
 * "nothing here" it sees for any page it has not been given, never naming what
 * this page would show. Read-only: nothing here creates, edits or deletes. What
 * each figure counts is written beside it and in `lib/internal/pilotMetrics.ts`.
 */
function NothingHere() {
  return (
    <PageShell width="reading">
      <PageHeader route="/internal/pilots" title="Not part of your access" />
      <p className="text-sm text-ink-muted">Nothing here for this account.</p>
    </PageShell>
  );
}

const COLUMNS: { key: string; label: string; what: string }[] = [
  { key: "jobs", label: "Jobs", what: "Jobs created, not counting the sample job." },
  { key: "sets", label: "Plan sets", what: "Plan sets uploaded, not counting the sample's." },
  { key: "sheets", label: "Sheets taken off", what: "Sheets with walls the finder put on the job." },
  { key: "typed", label: "Walls typed", what: "Wall runs a person typed, in the review queue or with Set type. Runs, not presses: no log of presses exists." },
  { key: "auto", label: "Auto-posted", what: "Wall runs the auto-post rule typed without a person." },
  { key: "bid", label: "Upload → bid", what: "Median time from a job's first plan set to its first signing link, over the jobs that have both." },
  { key: "reports", label: "Problem reports", what: "Report a problem sends, all time (last 7 days)." },
  { key: "errors", label: `Errors, ${WINDOW_DAYS} days`, what: "What the database records failing: plan pages whose reading stopped on an error, and emails that failed or bounced." },
  { key: "last", label: "Last activity", what: "The newest of a sign-in, a job created and a plan set uploaded." },
];

export default async function InternalPilotsPage() {
  const { company, ...currentUser } = await requireCompanyContext();
  if (!company.isProvaOperator) return <NothingHere />;
  if (currentUser.role !== "OWNER") {
    return (
      <PageShell width="reading">
        <PageHeader route="/internal/pilots" title="Owner only" />
        <p className="text-sm text-ink-muted">The pilot dashboard reads across companies, so it is the account owner&apos;s, same as Usage and the sales CRM.</p>
      </PageShell>
    );
  }

  const [rows, timeZone] = await Promise.all([loadPilotMetrics(), viewerTimeZone()]);
  const cell = "px-3 py-2 text-right tabular-nums";

  return (
    <PageShell width="working">
      <PageHeader route="/internal/pilots" title="Pilots" />
      <p className="mb-4 text-sm text-ink-body">
        Every customer company, most recently active first. Read-only, counted from what the product stores, on every load.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted" data-pilots="empty">
          No customer companies yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line-card bg-surface">
          <table className="w-full min-w-[960px] text-sm text-ink" data-pilots="table">
            <thead className="border-b border-line-card text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Company</th>
                {COLUMNS.map((column) => (
                  <th key={column.key} className="px-3 py-2 text-right font-medium" title={column.what}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.companyId} className="border-b border-line-card last:border-0" data-pilots="row" data-company={row.name}>
                  <td className="px-3 py-2 text-left font-medium">
                    <Link href={`/internal/pilots/${row.companyId}`} className="text-link hover:underline" data-pilots="open">
                      {row.name}
                    </Link>
                  </td>
                  <td className={cell} data-pilots="jobs">{row.jobs}</td>
                  <td className={cell} data-pilots="sets">{row.planSets}</td>
                  <td className={cell} data-pilots="sheets">{row.sheetsTakenOff}</td>
                  <td className={cell} data-pilots="typed">{row.wallsTypedByPerson}</td>
                  <td className={cell} data-pilots="auto">{row.autoPosted}</td>
                  <td className={cell} data-pilots="bid">
                    {formatElapsed(row.uploadToBidHours)}
                    {row.bidsSent > 0 && <span className="text-xs text-ink-muted"> ({row.bidsSent})</span>}
                  </td>
                  <td className={cell} data-pilots="reports">
                    {row.problemReports}
                    <span className="text-xs text-ink-muted"> ({row.problemReports7d})</span>
                  </td>
                  <td className={cell} data-pilots="errors" title={`${row.planReadErrors7d} plan page${row.planReadErrors7d === 1 ? "" : "s"}, ${row.emailErrors7d} email${row.emailErrors7d === 1 ? "" : "s"}`}>
                    {row.planReadErrors7d + row.emailErrors7d}
                  </td>
                  <td className={`${cell} whitespace-nowrap`} data-pilots="last">
                    {row.lastActivity ? formatInstant(row.lastActivity, timeZone) : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <dl className="mt-6 grid gap-2 text-xs text-ink-muted sm:grid-cols-2">
        {COLUMNS.map((column) => (
          <div key={column.key}>
            <dt className="inline font-medium text-ink-body">{column.label}: </dt>
            <dd className="inline">{column.what}</dd>
          </div>
        ))}
      </dl>
    </PageShell>
  );
}
