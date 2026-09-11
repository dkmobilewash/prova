"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createRfi, settleAskDraft } from "@/lib/actions";
import { RfiFields, type JobOption } from "@/components/RfiFields";
import { localToday } from "@/components/localToday";
import type { RfiDraft } from "@/lib/ask/drafts";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

export function RfiForm({
  jobs,
  defaultJobId,
  today,
  draft,
}: {
  jobs: JobOption[];
  defaultJobId?: string;
  today: string;
  /** A card from the Ask box: the form opens with these filled in, and
   * tells the card it saved. The sent date is NOT part of it — it stays
   * the form's own default below. */
  draft?: RfiDraft;
}) {
  const [isOpen, setIsOpen] = useState(draft !== undefined);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formDraft = useFormDraft("rfi:create");

  // A bare grey sentence where the button should be reads as a broken page
  // rather than as a reason nothing is actionable. Give it a real empty
  // state with the way out in it.
  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/50 p-5">
        <p className="text-sm font-medium text-slate-200">No jobs yet</p>
        <p className="mt-1 text-sm text-slate-400">
          An RFI is always a question about a specific set of drawings, so it has to belong to a job.
          Create one and the form will appear here.
        </p>
        <Link
          href="/dashboard"
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Go to Jobs
        </Link>
      </div>
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Raise an RFI
      </button>
    );
  }

  return (
    <form
      ref={formDraft.formRef}
      onChange={formDraft.save}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            await createRfi(formData);
            formDraft.clear();
            if (draft) void settleAskDraft(draft.proposalId);
            formDraft.resetForm();
            setIsOpen(false);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not raise the RFI");
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <h2 className="text-sm font-semibold text-slate-300">Raise an RFI</h2>
      <FormDraftNotice draft={formDraft} />

      <RfiFields
        jobs={jobs}
        defaultJobId={defaultJobId}
        defaults={{
          subject: draft?.subject ?? "",
          question: draft?.question ?? "",
          drawingReference: draft?.drawingReference ?? null,
          specSection: draft?.specSection ?? null,
          dueBy: null,
          sentOn: localToday(),
        }}
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save RFI"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
