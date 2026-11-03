import { notFound } from "next/navigation";
import { PageShell } from "@prova/ui";
import { PageHeader } from "@/components/PageHeader";
import { NoAccess } from "@/components/NoAccess";
import { secondaryActionClass } from "@/components/emptyStateStyles";
import { requireCapability } from "@/lib/authz";
import { changeOrderLog } from "@/lib/change-order-log";
import { loadChangeOrdersForLog } from "@/lib/change-order-log-query";
import { money } from "@/lib/money";
import { formatCalendarDate } from "@/lib/render-date";
import { viewerToday } from "@/lib/viewerToday";

export const metadata = { title: "Change order log" };

export const dynamic = "force-dynamic";

const shown = (day: string | null) => (day ? formatCalendarDate(new Date(`${day}T00:00:00Z`)) : "—");

/** Read-only: every change order sent to the GC, with totals and the pending ones
 * by age. The downloads carry the same rows. */
export default async function ChangeOrderLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { context, allowed } = await requireCapability("VIEW_JOB_COSTS");
  if (!allowed) return <NoAccess capability="VIEW_JOB_COSTS" />;
  const { id } = await params;
  const loaded = await loadChangeOrdersForLog(id, context.company.id);
  if (!loaded) notFound();
  const today = await viewerToday();
  const log = changeOrderLog(loaded.changeOrders, today);

  return (
    <PageShell width="working">
      <PageHeader
        route="/dashboard"
        parent={[
          { href: `/jobs/${id}`, label: loaded.jobName },
          { href: `/jobs/${id}/estimate#change-orders`, label: "Change orders" },
        ]}
        title="Change order log"
        actions={
          <span className="flex flex-wrap gap-2">
            <a href={`/api/jobs/${id}/change-order-log?format=csv`} className={secondaryActionClass}>
              Download CSV
            </a>
            <a href={`/api/jobs/${id}/change-order-log?format=xlsx`} className={secondaryActionClass}>
              Download Excel
            </a>
          </span>
        }
      />
      <p className="mt-2 text-sm text-ink-muted">
        As of {shown(today)}. Drafts are not listed{log.drafts > 0 ? ` (${log.drafts} on this job)` : ""}.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          ["Executed", log.totals.approved],
          ["Pending GC", log.totals.pending],
          ["Rejected", log.totals.rejected],
        ].map(([label, total]) => (
          <div key={label as string} className="rounded-lg border border-line-card bg-surface p-3">
            <p className="text-xs text-ink-muted">{label as string}</p>
            <p className="text-lg tabular-nums text-ink">{money((total as { amount: number }).amount)}</p>
            <p className="text-xs text-ink-muted">{(total as { count: number }).count} change orders</p>
          </div>
        ))}
      </div>

      <h2 className="mt-6 text-sm font-semibold text-ink-label">Pending, by age</h2>
      <ul className="mt-2 flex flex-wrap gap-4 text-sm text-ink-body">
        {log.aging.map((band) => (
          <li key={band.label}>
            {band.label}: {band.count} · {money(band.amount)}
          </li>
        ))}
      </ul>

      {log.rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">No change order has been sent to the GC on this job yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="text-xs text-ink-muted">
                <th className="pb-1 pr-3 font-normal">CO</th>
                <th className="pb-1 pr-3 font-normal">Title</th>
                <th className="pb-1 pr-3 font-normal">Status</th>
                <th className="pb-1 pr-3 font-normal">Submitted</th>
                <th className="pb-1 pr-3 text-right font-normal">Days pending</th>
                <th className="pb-1 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {log.rows.map((row) => (
                <tr key={row.number} className="border-t border-line-row">
                  <td className="py-1.5 pr-3 tabular-nums text-ink">{row.number}</td>
                  <td className="py-1.5 pr-3 text-ink-label">
                    {row.title}
                    {row.revises !== null && <span className="text-xs text-ink-muted"> · revises CO {row.revises}</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-ink-body">{row.statusLabel}</td>
                  <td className="py-1.5 pr-3 text-ink-body">{shown(row.submittedOn)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink-body">{row.daysPending ?? ""}</td>
                  <td className="py-1.5 text-right tabular-nums text-ink">{money(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
