"use client";

import { useRef, useState, useTransition } from "react";
import { createPunchListItem } from "@/lib/actions";

// 16px, not the 14px inherited from the `text-sm` label: iOS Safari zooms the
// whole page when a focused input is under 16px, and the foreman then has to
// pinch back out between fields. `min-h-11` is a 44px tap target.
const inputClass =
  "min-h-11 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

export type JobOption = { id: string; name: string };

/** Stays open after a save, unlike the vendor and equipment forms. Punch
 * items get logged in bursts during a walkthrough — five in a row, same
 * job — so collapsing after each one would fight the user. The job
 * selection is kept; the description clears. */
export function PunchListForm({ jobs, defaultJobId }: { jobs: JobOption[]; defaultJobId?: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState(defaultJobId ?? jobs[0]?.id ?? "");
  const descriptionRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await createPunchListItem(formData);
        if (descriptionRef.current) {
          descriptionRef.current.value = "";
          descriptionRef.current.focus();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add item");
      }
    });
  }

  if (jobs.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Punch list items attach to a job, and there aren&apos;t any yet. Create a job first.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex min-h-11 items-center justify-center self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? "Adding…" : "Add item"}
      </button>
    </form>
  );
}
