import Link from "next/link";
import { formatCalendarDate } from "@/lib/render-date";
import { money } from "@/lib/money";
import type { JobSummary } from "@/lib/jobs/job-summary";

/**
 * The job's name and the three numbers a sub asks first — contract, billed
 * to date, left to bill — always visible above the stage steps. The
 * founder's words: "you should be able to see everything without having
 * to scroll."
 *
 * Money is withheld the way it always was — contract value behind
 * VIEW_JOB_COSTS, billed behind MANAGE_BILLING, and "left to bill" needs
 * both since it is one minus the other — computed by the caller and simply
 * absent here, never a blank or a lock icon. Both figures are
 * `loadJobSummary`'s, unchanged; left to bill is their difference and
 * nothing else.
 *
 * Crew size and stage moved to the stage steps below, which say them in
 * words. The header has no trade, job number or PM: the Job model stores
 * none of the three, and an invented one is worse than none.
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
  const figures = [
    ...(showsJobMoney ? [{ label: "Contract", value: summary.contractValue }] : []),
    ...(showsBilling ? [{ label: "Billed to date", value: summary.billedToDate }] : []),
    ...(showsJobMoney && showsBilling
      ? [{ label: "Left to bill", value: summary.contractValue - summary.billedToDate }]
      : []),
  ];
  const dates =
    summary.startDate || summary.endDate
      ? `${summary.startDate ? formatCalendarDate(summary.startDate) : "—"} – ${
          summary.endDate ? formatCalendarDate(summary.endDate) : "—"
        }`
      : null;

  return (
    <header className="mb-4 sm:mb-5 print:hidden">
      <Link href="/jobs" className="inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-ink hover:underline mouse:min-h-7">
        ← All jobs
      </Link>
      <div className="mt-1 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-balance break-words font-headline text-[30px] leading-[1.05] text-ink sm:text-[38px]">{summary.name}</h1>
          <p className="mt-1 text-[15px] text-ink-muted">
            <span className="font-medium text-ink-body">{summary.contactName}</span>
            {dates && <> · {dates}</>}
          </p>
          {/* WHERE THE JOB ACTUALLY IS, only when it is not just the stored
              status restated — `source === "status"` means lib/job-lifecycle.ts
              found nothing the steps below do not already say. The evidence
              is printed, not hidden: the stage is a READING of the data. */}
          {summary.lifecycle.source !== "status" && (
            <p className="mt-1 text-sm">
              <span className="font-medium text-ink">{summary.lifecycle.label}</span>
              <span className="text-ink-muted"> — {summary.lifecycle.because}</span>
            </p>
          )}
        </div>
        {figures.length > 0 && (
          // Wraps, not a 3-column grid: at 375px "$12,345,678.90" measured
          // 113px in a 101px column and ran into "Billed to date".
          <dl className="flex flex-wrap gap-x-6 gap-y-2 sm:flex-nowrap sm:gap-10 lg:text-right">
            {figures.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.06em] text-ink-muted sm:text-xs">{f.label}</dt>
                <dd className="text-sm font-semibold tabular-nums text-ink sm:text-2xl">{money(f.value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </header>
  );
}
