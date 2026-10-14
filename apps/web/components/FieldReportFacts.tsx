import { formatHours } from "@/lib/render-hours";

/** The closed row: date · job · crew · hours · delay flag · filed by. Shared
 * by the company-wide log and the job's own tab, so the two lists read the
 * same. Plain text only — a link or button inside `<summary>` would toggle
 * the row as well as do its own thing. */
export function FieldReportFacts({
  dateLabel,
  jobName,
  manpower,
  hasDelays,
  filedByName,
  lockedLabel,
}: {
  dateLabel: string;
  jobName?: string;
  manpower?: { headcount: number; hours: number } | null;
  hasDelays: boolean;
  filedByName: string | null;
  lockedLabel?: string | null;
}) {
  return (
    <span data-report-facts className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="font-medium text-ink">{dateLabel}</span>
      {jobName && <span className="text-ink-body">· {jobName}</span>}
      {manpower && (
        <span className="text-ink-body">
          · {manpower.headcount === 0 ? "no hours logged" : `${manpower.headcount} crew · ${formatHours(manpower.hours)}h`}
        </span>
      )}
      {hasDelays && <span className="rounded bg-tag-amber px-1.5 text-xs text-tag-amber-ink">Delay</span>}
      {lockedLabel && <span className="text-xs text-ok">{lockedLabel} · locked</span>}
      {filedByName && <span className="ml-auto text-xs text-ink-body">filed by {filedByName}</span>}
    </span>
  );
}
