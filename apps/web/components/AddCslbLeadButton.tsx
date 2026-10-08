"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCslbLead } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";

/** One firm from the call list becomes a lead, on a person's decision. Disabled in flight so a double click cannot make two. */
export function AddCslbLeadButton({ licence }: { licence: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await addCslbLead(licence);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.refresh();
          });
        }}
        className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
      >
        {pending ? <Spinner /> : null}
        Add as lead
      </button>
      {error ? <p className="text-xs text-tag-rose-ink">{error}</p> : null}
    </div>
  );
}
