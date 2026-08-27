"use client";

export const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
export const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

export type JobOption = { id: string; name: string };

export type RfiDefaults = {
  subject: string;
  question: string;
  drawingReference: string | null;
  specSection: string | null;
  dueBy: string | null;
  sentOn: string | null;
};

/** The question half of an RFI, shared by create and edit so they can't
 * drift. The job select only appears on create — on an RFI that has been
 * sent, the job and number are what the GC has in writing. */
export function RfiFields({
  defaults,
  jobs,
  defaultJobId,
}: {
  defaults: RfiDefaults;
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
        Subject
        <input
          type="text"
          name="subject"
          required
          defaultValue={defaults.subject}
          placeholder="e.g. Head-of-wall detail at rated corridor"
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        Question
        <textarea
          name="question"
          required
          rows={3}
          defaultValue={defaults.question}
          placeholder="State the conflict and what you need decided. One question per RFI — bundled questions come back half-answered."
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Date sent
          <input type="date" name="sentOn" defaultValue={defaults.sentOn ?? ""} className={inputClass} />
          <span className="text-xs text-slate-500">
            Blank keeps it a draft. Backdate it when you&apos;re entering an RFI you already sent.
          </span>
        </label>
        <label className={labelClass}>
          Answer needed by
          <input type="date" name="dueBy" defaultValue={defaults.dueBy ?? ""} className={inputClass} />
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
        <label className={labelClass}>
          Spec section
          <input
            type="text"
            name="specSection"
            defaultValue={defaults.specSection ?? ""}
            placeholder="e.g. 09 21 16"
            className={inputClass}
          />
        </label>
      </div>
    </>
  );
}
