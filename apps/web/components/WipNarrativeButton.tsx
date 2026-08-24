"use client";

import { useState, useTransition } from "react";
import { generateJobWipNarrative } from "@/lib/actions";

/** On-demand only — nothing here is cached or persisted, so every click
 * calls the API fresh. See generateJobWipNarrative in lib/actions.ts. */
export function WipNarrativeButton({ jobId }: { jobId: string }) {
  const [isPending, startTransition] = useTransition();
  const [narrative, setNarrative] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const text = await generateJobWipNarrative(jobId);
        setNarrative(text);
      } catch (err) {
        setNarrative(null);
        setError(err instanceof Error ? err.message : "Couldn't generate a narrative");
      }
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex w-fit items-center justify-center rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
      >
        {isPending ? "Analyzing…" : narrative ? "Regenerate analysis" : "Explain this WIP"}
      </button>
      {narrative && (
        <p className="max-w-2xl rounded-md border border-slate-800 bg-slate-900 p-3 text-sm text-slate-300">
          {narrative}
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
