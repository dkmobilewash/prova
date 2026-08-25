"use client";

import { useRef, useState, useTransition } from "react";
import { draftLineItemsFromScope } from "@/lib/actions";

/** Turns pasted scope text into draft line items via a real Claude call
 * (several seconds), same pending-state pattern as WipNarrativeButton and
 * ComplianceUploadForm. revalidatePath inside the server action refreshes
 * the line items list below once it lands. */
export function DraftLineItemsForm({ jobId, initialScope }: { jobId: string; initialScope: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await draftLineItemsFromScope(jobId, formData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't draft line items from that text");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="mb-4 flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Draft line items from scope of work
        <textarea
          name="scopeText"
          defaultValue={initialScope}
          rows={3}
          placeholder="Paste or describe the scope of work — Claude will break it into draft line items below."
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex w-fit items-center justify-center rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
      >
        {isPending ? "Drafting…" : "Draft line items"}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
