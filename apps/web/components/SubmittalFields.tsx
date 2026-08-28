"use client";

import { inputClass, labelClass, type JobOption } from "@/components/RfiFields";

export type SubmittalDefaults = {
  title: string;
  description: string | null;
  specSection: string | null;
  drawingReference: string | null;
};

/** The package-identity half of a submittal, shared by create and edit so
 * they can't drift. The job select only appears on create — job and
 * number are what the GC's transmittal log has in writing. */
export function SubmittalFields({
  defaults,
  jobs,
  defaultJobId,
}: {
  defaults: SubmittalDefaults;
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
        Title
        <input
          type="text"
          name="title"
          required
          defaultValue={defaults.title}
          placeholder="e.g. Interior metal framing shop drawings, level 2"
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        What&apos;s in the package
        <textarea
          name="description"
          rows={2}
          defaultValue={defaults.description ?? ""}
          placeholder="Sheets, product data, samples — enough that a reader knows which package this number points at."
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Spec section
          <input
            type="text"
            name="specSection"
            defaultValue={defaults.specSection ?? ""}
            placeholder="e.g. 09 22 16"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Drawing reference
          <input
            type="text"
            name="drawingReference"
            defaultValue={defaults.drawingReference ?? ""}
            placeholder="e.g. A-501 / 3"
            className={inputClass}
          />
        </label>
      </div>
    </>
  );
}
