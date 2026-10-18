"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSalesLeadSignal } from "@/lib/actions";
import { SalesSignalFields } from "@/components/SalesSignalFields";
import { Spinner } from "@/components/Spinner";

/**
 * Add a signal by hand. Collapsed behind a button, per this app's list-page
 * convention.
 *
 * This is the whole of slice one's write path, and it needs no model. That is
 * deliberate rather than a staging decision: it means the screen, the action
 * and the band are all exercised by a real person before any research call
 * exists, so the model half cannot land as a seam nothing calls — the shape
 * CLAUDE.md names "written, documented, and never called".
 *
 * `onSubmit` RATHER THAN `<form action={fn}>`, AND THAT IS NOT A STYLE CHOICE.
 * In React 19 a client form submitted through `action` RESETS BEFORE the
 * action runs, so a returned refusal arrives over emptied fields. This form
 * refuses for a reason somebody will actually hit — a source link that is not
 * a full web address — and losing a typed claim and URL to it would be worse
 * than the refusal itself. `formActionCensus.test.ts` caught this exact
 * mistake here, after it was written the wrong way; the pattern below is
 * `components/LogTimeEntryForm.tsx`'s.
 */
export function SalesSignalForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-800"
      >
        Add something you found
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await createSalesLeadSignal(leadId, formData);
          if (!result.ok) {
            // The fields are untouched, so the person can fix the one thing
            // that was wrong rather than retype the sentence they found.
            setError(result.error);
            return;
          }
          setOpen(false);
          router.refresh();
        });
      }}
      className="rounded-md border border-line-card bg-canvas p-4"
    >
      <SalesSignalFields />
      {error && <p className="mt-3 text-xs text-tag-rose-ink">{error}</p>}
      <div className="mt-4 flex gap-2">
        {/* Not `SubmitButton`: that reads `useFormStatus`, which only reports
            for a form submitted through `action` — the very thing above. With
            `onSubmit` it would never show pending, so the spinner rides the
            transition instead. */}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-60"
        >
          {pending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Adding…
            </span>
          ) : (
            "Add it"
          )}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
