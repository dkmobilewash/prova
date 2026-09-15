"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { createDrawingSet } from "@/lib/actions";
import { type JobOption } from "@/components/RfiFields";
import { DrawingSetFields } from "@/components/DrawingSetFields";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

export function DrawingSetForm({ jobs, defaultJobId }: { jobs: JobOption[]; defaultJobId?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = useFormDraft("drawing-set:create");

  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line-card bg-surface/50 p-5">
        <p className="text-sm font-medium text-ink-label">No jobs yet</p>
        <p className="mt-1 text-sm text-ink-body">
          A drawing set is always the drawings for a specific job, so it has to belong to one. Create
          a job and the form will appear here.
        </p>
        <Link
          href="/dashboard"
          className="mt-3 inline-block rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
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
        className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
      >
        Add a drawing set
      </button>
    );
  }

  return (
    <form
      ref={draft.formRef}
      onChange={draft.save}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createDrawingSet(formData);
          if (result.ok) {
            draft.clear();
            draft.resetForm();
            setIsOpen(false);
          } else {
            setError(result.error);
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-line-card bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-ink-label">Add a drawing set</h2>
      <FormDraftNotice draft={draft} />

      <DrawingSetFields jobs={jobs} defaultJobId={defaultJobId} defaults={{ name: "", description: null }} />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save set"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-800 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
