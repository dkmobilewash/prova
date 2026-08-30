"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions/shared";

/**
 * Locks the estimate in as a contract.
 *
 * This used to catch a thrown error and render its message, which looked
 * correct and was not: production redacts thrown Server Action messages,
 * so "Add at least one line item before contracting this job" reached the
 * user as "An error occurred in the Server Components render." The slot
 * for the message was always here — the message just never survived the
 * trip. The action returns it now.
 */
export function MarkContractedButton({
  markContracted,
}: {
  markContracted: () => Promise<ActionResult>;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await markContracted();
            if (!result.ok) setError(result.error);
          });
        }}
        className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? "Marking as contracted…" : "Mark as contracted"}
      </button>
      {error && <p className="mt-2 text-sm text-amber-400">{error}</p>}
    </div>
  );
}
