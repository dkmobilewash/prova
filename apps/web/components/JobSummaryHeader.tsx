import { JOB_STATUS_LABELS, isJobStatus } from "@/lib/job-status-transitions";
import { formatCalendarDate } from "@/lib/render-date";
import { money } from "@/lib/money";
import { JOB_SUMMARY_GRID, jobSummaryTileCount } from "@/components/jobSummaryGrid";
import type { JobSummary } from "@/lib/jobs/job-summary";

/**
 * Always visible, no scrolling — the founder's own words: "you should be
 * able to see everything without having to scroll. And then if you want
 * to go into a piece of it, then you just click into it." This is
 * "everything" at the top level: the few figures a decision about this
 * job actually needs before you click into a section for the rest.
 *
 * Money figures are withheld the same way the sections themselves always
 * were — contract value behind VIEW_JOB_COSTS, billed/retainage behind
 * MANAGE_BILLING — computed by the caller and simply absent here, not
 * rendered as a blank or a lock icon. Dates and crew size are ungated,
 * matching the Schedule section they used to live in.
 */
export function JobSummaryHeader({
  summary,
  showsJobMoney,
  showsBilling,
}: {
  summary: JobSummary;
  showsJobMoney: boolean;
  showsBilling: boolean;
}) {
  const statusLabel = isJobStatus(summary.status) ? JOB_STATUS_LABELS[summary.status] : summary.status;
  const gridClass = JOB_SUMMARY_GRID[jobSummaryTileCount(showsJobMoney, showsBilling)];

  return (
    <div className="mb-4 rounded-lg border border-line-card bg-surface p-4 print:hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-ink">{summary.name}</h1>
        <span className="inline-flex items-center rounded-full bg-neutral-800 px-2.5 py-0.5 text-xs font-medium text-ink-label">
          {statusLabel}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-body">{summary.contactName}</p>

      <dl className={`mt-3 ${gridClass}`}>
        {showsJobMoney && (
          <div>
            <dt className="text-xs text-ink-muted">Contract value</dt>
            <dd className="text-ink">{money(summary.contractValue)}</dd>
          </div>
        )}
        {showsBilling && (
          <>
            <div>
              <dt className="text-xs text-ink-muted">Billed to date</dt>
              <dd className="text-ink">{money(summary.billedToDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Retainage held</dt>
              <dd className="text-ink">{money(summary.retainageBalance)}</dd>
            </div>
          </>
        )}
        <div>
          <dt className="text-xs text-ink-muted">Crew</dt>
          <dd className="text-ink">
            {summary.crewSize} {summary.crewSize === 1 ? "person" : "people"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Dates</dt>
          <dd className="text-ink">
            {summary.startDate ? formatCalendarDate(summary.startDate) : "—"}
            {" – "}
            {summary.endDate ? formatCalendarDate(summary.endDate) : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
