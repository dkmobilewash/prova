"use client";

import { inputClass, labelClass, type JobOption } from "@/components/RfiFields";

export type DrawingSetDefaults = {
  name: string;
  description: string | null;
};

/** The identity half of a drawing set, shared by create and edit so the
 * two can't drift. The job select only appears on create — a set belongs
 * to the job whose drawings it is, and moving it would mean a new set. */
export function DrawingSetFields({
  defaults,
  jobs,
  defaultJobId,
}: {
  defaults: DrawingSetDefaults;
  jobs?: JobOption[];
  defaultJobId?: string;
}) {
  return (
    <>
      {jobs && (
        <label className={labelClass}>
          Job
          <select name="jobId" required defaultValue={defaultJobId ?? ""} className={inputClass}>
            <option value="" disabled>
              Choose a job
            </option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className={labelClass}>
        Set name
        <input
          type="text"
          name="name"
          required
          defaultValue={defaults.name}
          placeholder="e.g. Architectural, Structural, Life Safety"
          className={inputClass}
        />
        <span className="text-xs text-slate-500">
          Whatever the job calls it. One name per job — two sets with the same name would make
          &ldquo;which is current&rdquo; unanswerable.
        </span>
      </label>

      <label className={labelClass}>
        Notes
        <textarea
          name="description"
          rows={2}
          defaultValue={defaults.description ?? ""}
          placeholder="Which sheets this covers, who issues it, anything a reader would need."
          className={inputClass}
        />
      </label>
    </>
  );
}
