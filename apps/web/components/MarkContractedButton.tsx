"use client";

import { useState, useTransition } from "react";

export function MarkContractedButton({ markContracted }: { markContracted: () => Promise<void> }) {
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
            try {
              await markContracted();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not mark this job as contracted");
            }
          });
        }}
        className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? "Marking as contracted…" : "Mark as contracted"}
      </button>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
