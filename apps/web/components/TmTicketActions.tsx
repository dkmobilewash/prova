"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { draftChangeOrderFromTmTicket } from "@/lib/actions";
import { Hint } from "@/components/Hint";

const rowBtn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-50";

/**
 * The one control on a signed T&M ticket row: start a change order from it,
 * or, once one exists, the link to it. Same shape as the delay log's
 * "Draft change order" (DelayLog.tsx), returned-result handling included —
 * production redacts a thrown Server Action message, so the refusal has to
 * come back as a sentence and be rendered here.
 */
export function TmTicketActions({
  ticketId,
  jobId,
  changeOrder,
}: {
  ticketId: string;
  jobId: string;
  changeOrder: { number: number; status: string } | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (changeOrder) {
    return (
      <Link href={`/jobs/${jobId}/estimate#change-orders`} className="self-center text-xs text-link hover:underline">
        Change order #{changeOrder.number} ({changeOrder.status.toLowerCase()}) →
      </Link>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1 self-center">
      <Hint text="Starts a DRAFT change order carrying this ticket's signed hours and materials as text. Nothing is priced and nothing reaches the GC until you price and submit it.">
        <button
          type="button"
          disabled={isPending}
          className={rowBtn}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                const result = await draftChangeOrderFromTmTicket(ticketId);
                if (!result.ok) setError(result.error);
              } catch {
                setError("That did not go through. Reload the page and check before trying again.");
              }
            });
          }}
        >
          {isPending ? "Drafting…" : "Draft change order"}
        </button>
      </Hint>
      {error && <p className="max-w-xs text-right text-xs text-danger">{error}</p>}
    </div>
  );
}
