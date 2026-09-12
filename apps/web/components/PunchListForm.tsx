"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createPunchListItem } from "@/lib/actions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

// 16px, not the 14px inherited from the `text-sm` label: iOS Safari zooms the
// whole page when a focused input is under 16px, and the foreman then has to
// pinch back out between fields. `min-h-11` is a 44px tap target.
const inputClass =
  "min-h-11 rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-ink-label";

export type JobOption = { id: string; name: string };

/** Stays open after a save, unlike the vendor and equipment forms. Punch
 * items get logged in bursts during a walkthrough — five in a row, same
 * job — so collapsing after each one would fight the user. The job
 * selection is kept; the description clears. */
export function PunchListForm({
  jobs,
  defaultJobId,
}: {
  jobs: JobOption[];
  defaultJobId?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState(defaultJobId ?? jobs[0]?.id ?? "");
  const descriptionRef = useRef<HTMLInputElement>(null);
  // The job select is controlled, so the hook alone can't restore it —
  // onRestore/onDiscard keep the state in step with the DOM.
  const formDraft = useFormDraft("punch-list:create", {
    onRestore: (values) => {
      const restoredJob = values.jobId;
      if (typeof restoredJob === "string" && jobs.some((job) => job.id === restoredJob)) {
        setJobId(restoredJob);
      }
    },
    onDiscard: () => setJobId(defaultJobId ?? jobs[0]?.id ?? ""),
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createPunchListItem(formData);
      // The refusal is RETURNED now, not thrown: a thrown Server Action
      // message is replaced in production by React's own "omitted in
      // production builds" paragraph, so the `err.message` this used to
      // render was never "Description is required". Nothing is cleared on
      // the failure branch, so what was typed is still in the fields.
      if (!result.ok) {
        setError(result.error);
        return;
      }
      formDraft.clear();
      if (descriptionRef.current) {
        descriptionRef.current.value = "";
        descriptionRef.current.focus();
      }
    });
  }

  // The same case /photos handles with a real link — refusing with a bare
  // sentence leaves the one thing to do next as something you have to go
  // and find.
  if (jobs.length === 0) {
    return (
      <div>
        <p className="text-sm text-ink-body">
          Punch list items attach to a job, and there aren&apos;t any yet.
        </p>
        <Link
          href="/jobs/new"
          className="mt-3 inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-medium text-neutral-900 hover:bg-yellow-500"
        >
          Create a job
        </Link>
      </div>
    );
  }

  return (
    <form ref={formDraft.formRef} onSubmit={handleSubmit} onChange={formDraft.save} className="flex flex-col gap-3">
      <FormDraftNotice draft={formDraft} />
      <label className={labelClass}>
        Job
        <select
          name="jobId"
          value={jobId}
          onChange={(event) => setJobId(event.target.value)}
          className={inputClass}
        >
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        What needs fixing
        <input
          ref={descriptionRef}
          type="text"
          name="description"
          required
          placeholder="e.g. Ceiling grid out of level, east corridor"
          className={inputClass}
        />
      </label>

      {/* role="alert" so the reason is announced rather than only drawn —
          the person who just submitted is usually still looking at the
          field they think is wrong, not at this line. */}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex min-h-11 items-center justify-center self-start rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500 disabled:opacity-50"
      >
        {isPending ? "Adding…" : "Add item"}
      </button>
    </form>
  );
}
