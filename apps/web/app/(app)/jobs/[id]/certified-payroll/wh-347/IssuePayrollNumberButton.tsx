"use client";

import { useState, useTransition } from "react";
import { issuePayrollNumber } from "@/lib/actions";

/**
 * Issues this job-week's WH-347 payroll number.
 *
 * Deliberately a button, not a side effect of the page rendering — a page
 * load is not an intent to file, and a number issued by a stray render
 * would leave holes in the project's sequence for weeks nobody actually
 * filed. See issueWh347PayrollNumber and Wh347PayrollCounter.
 *
 * Calling the action directly (rather than via a form) still gets the
 * revalidatePath refresh: an action POST always re-renders from the root
 * (CLAUDE.md's #61 entry), so no router.refresh() is needed here — the
 * page's own payrollNumber prop updates on the next server render.
 */
export function IssuePayrollNumberButton({ jobId, weekStart }: { jobId: string; weekStart: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="print:hidden inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          const formData = new FormData();
          formData.set("jobId", jobId);
          formData.set("weekStart", weekStart);
          startTransition(async () => {
            const result = await issuePayrollNumber(formData);
            if (!result.ok) setError(result.error);
          });
        }}
        className="min-h-11 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Issuing…" : "Issue this week's payroll number"}
      </button>
      {error && <span className="text-xs text-tag-rose-ink">{error}</span>}
    </span>
  );
}
