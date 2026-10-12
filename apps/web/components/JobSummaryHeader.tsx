import Link from "next/link";
import { formatCalendarDate } from "@/lib/render-date";
import { money } from "@/lib/money";
import type { JobSummary } from "@/lib/jobs/job-summary";
import type { ActionResult } from "@/lib/actions/shared";
import { MarkContractedButton } from "@/components/MarkContractedButton";

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
  contractSigned = false,
  markContracted,
}: {
  summary: JobSummary;
  showsJobMoney: boolean;
  showsBilling: boolean;
  /** Whether the GC's signature or an executed subcontract is on file —
   * markJobContracted's evidence gate, read the same way it reads it. */
  contractSigned?: boolean;
  /** `markJobContracted` bound to this job, passed only to a viewer who may
   * call it. While the job is a bid this is the "We won it" step, on every
   * tab: it used to live only at the bottom of the estimate page. */
  markContracted?: () => Promise<ActionResult>;
}) {
  // A bid has no contract and nothing to bill yet: the figure is the bid,
  // and "Billed to date" / "Left to bill" would only restate zero as a fact.
  const isBid = summary.status === "ESTIMATE";
  const figures = [
    ...(showsJobMoney ? [{ label: isBid ? "Bid" : "Contract", value: summary.contractValue }] : []),
    ...(showsBilling && !isBid ? [{ label: "Billed to date", value: summary.billedToDate }] : []),
    ...(showsJobMoney && showsBilling && !isBid
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
      {/* The jobs list is the dashboard (`/jobs` only redirects there), so
          link it directly rather than through a redirect. */}
      <Link href="/dashboard" className="inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-ink hover:underline mouse:min-h-7">
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
      {isBid && markContracted && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-line-card bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-body">
            <span className="font-semibold text-ink">Won it?</span>{" "}
            {contractSigned
              ? "The contract is executed — mark the job contracted to open change orders and billing."
              : "Record the executed subcontract the GC sent you (or send them a signing link) first, then mark it contracted."}
          </p>
          {contractSigned ? (
            <MarkContractedButton markContracted={markContracted} />
          ) : (
            <Link
              href={`/jobs/${summary.id}#contract-signature`}
              className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-link hover:text-link-hover hover:underline mouse:min-h-8"
            >
              Go to Contract signature →
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
