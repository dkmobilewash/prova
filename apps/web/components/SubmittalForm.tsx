"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { createSubmittal } from "@/lib/actions";
import { inputClass, labelClass, type JobOption } from "@/components/RfiFields";
import { SubmittalFields } from "@/components/SubmittalFields";
import { localToday } from "@/components/localToday";

export function SubmittalForm({ jobs, defaultJobId }: { jobs: JobOption[]; defaultJobId?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (jobs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/50 p-5">
        <p className="text-sm font-medium text-slate-200">No jobs yet</p>
        <p className="mt-1 text-sm text-slate-400">
          A submittal is always a package against a specific job&apos;s spec sections, so it has to
          belong to a job. Create one and the form will appear here.
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
        Log a submittal
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
          // Actions in this module return their failures instead of
          // throwing — a thrown message is redacted to a digest in
          // production builds, verified 2026-08-27.
          const result = await createSubmittal(formData);
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
      <h2 className="text-sm font-semibold text-slate-300">Log a submittal</h2>

      <SubmittalFields
        jobs={jobs}
        defaultJobId={defaultJobId}
        defaults={{ title: "", description: null, specSection: null, drawingReference: null }}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Date sent
          <input type="date" name="sentOn" defaultValue={localToday()} className={inputClass} />
          <span className="text-xs text-slate-500">
            Blank means it hasn&apos;t gone out yet. Backdate it when you&apos;re entering a package you
            already sent.
          </span>
        </label>
        <label className={labelClass}>
          Answer needed back by
          <input type="date" name="dueBack" defaultValue="" className={inputClass} />
        </label>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save submittal"}
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
