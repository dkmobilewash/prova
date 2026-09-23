"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createRfi, settleAskDraft } from "@/lib/actions";
import { RfiFields, type JobOption } from "@/components/RfiFields";
import type { RfiDraft } from "@/lib/ask/drafts";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

export function RfiForm({
  jobs,
  defaultJobId,
  draft,
}: {
  jobs: JobOption[];
  defaultJobId?: string;
  /** A card from the Ask box: the form opens with these filled in, and
   * tells the card it saved. The sent date is NOT part of it — a draft
   * proposed by the assistant has not been sent to anybody either. */
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
      <div className="rounded-lg border border-dashed border-line-card bg-surface/50 p-5">
        <p className="text-sm font-medium text-ink-label">No jobs yet</p>
        <p className="mt-1 text-sm text-ink-body">
          An RFI is always a question about a specific set of drawings, so it has to belong to a job.
          Create one and the form will appear here.
        </p>
        <Link
          href="/dashboard"
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
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
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
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
          const result = await createRfi(formData);
          // Returned, not thrown. `createRfi`'s guards are sentences written
          // for somebody in a dispute, and production replaces a thrown
          // Server Action message with React's own "omitted in production
          // builds" paragraph — so the `err.message` this used to render was
          // that paragraph, every time. The form is reset and closed only on
          // the OK branch, so a refusal leaves the question as typed.
          if (!result.ok) {
            setError(result.error);
            return;
          }
          formDraft.clear();
          if (draft) void settleAskDraft(draft.proposalId);
          formDraft.resetForm();
          setIsOpen(false);
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-ink-label">Raise an RFI</h2>
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
          // BLANK, and this is the safe side of a one-way door rather than
          // a preference. A sent date makes the new RFI SENT, and `updateRfi`
          // refuses SENT -> draft while `deleteRfi` takes drafts only — so a
          // date nobody chose is a record nobody can take back, on the page
          // whose whole subject is dates being defensible. The helper text
          // under this field has always said "Blank keeps it a draft"; the
          // form never once started there. Draft first, then "Mark sent" on
          // the day it actually leaves.
          sentOn: null,
        }}
      />

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
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
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
