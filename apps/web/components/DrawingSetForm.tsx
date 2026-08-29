"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { createDrawingSet } from "@/lib/actions";
import { type JobOption } from "@/components/RfiFields";
import { DrawingSetFields } from "@/components/DrawingSetFields";

export function DrawingSetForm({ jobs, defaultJobId }: { jobs: JobOption[]; defaultJobId?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/50 p-5">
        <p className="text-sm font-medium text-slate-200">No jobs yet</p>
        <p className="mt-1 text-sm text-slate-400">
          A drawing set is always the drawings for a specific job, so it has to belong to one. Create
          a job and the form will appear here.
        </p>
        <Link
          href="/dashboard"
          className="mt-3 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
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
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
      >
        Add a drawing set
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await createDrawingSet(formData);
          if (result.ok) {
            formRef.current?.reset();
            setIsOpen(false);
          } else {
            setError(result.error);
          }
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4"
    >
      <h2 className="text-sm font-semibold text-slate-300">Add a drawing set</h2>

      <DrawingSetFields jobs={jobs} defaultJobId={defaultJobId} defaults={{ name: "", description: null }} />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
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
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
