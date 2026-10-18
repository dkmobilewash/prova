"use client";

import { useState, useTransition } from "react";
import { restoreFinding } from "@/lib/actions/agentFindings";
import { Spinner } from "@/components/Spinner";

/** Puts a dismissed finding back on the open list. The action revalidates
 *  /ai/activity, so the row loses its "Dismissed" tag on its own. */
export function RestoreFindingButton({ findingId }: { findingId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const res = await restoreFinding(findingId);
              if (!res.ok) setError(res.error);
            } catch {
              setError("Couldn't restore it just now — try again.");
            }
          });
        }}
        className="inline-flex min-h-9 items-center rounded-md border border-line-card px-3 text-sm font-medium text-ink-label hover:bg-rail-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
      >
        {isPending ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner />
            Restoring…
          </span>
        ) : (
          "Restore"
        )}
      </button>
      {error && (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
