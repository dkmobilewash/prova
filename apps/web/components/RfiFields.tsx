"use client";

export const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
export const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

/**
 * The same input, sized for a phone.
 *
 * `inputClass` above is imported by 25 other components across the whole app,
 * most of them office screens in the other lane, so it is deliberately NOT
 * changed here — this is the field-screen override and it is applied only to
 * the RFI form's own fields.
 *
 * Two things it adds. `text-base`: these inputs sit inside a `text-sm` label
 * and INHERIT 14px, and iOS Safari zooms the whole page whenever a focused
 * field is under 16px, leaving you zoomed in and scrolled sideways after every
 * tap. `min-h-11`: 44px, the tap-target floor — the date inputs measured 40px.
 */
export const fieldInputClass = `min-h-11 text-base ${inputClass}`;

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
          <select name="jobId" required defaultValue={defaultJobId ?? ""} className={fieldInputClass}>
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
          className={fieldInputClass}
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
          className={fieldInputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Date sent
          <input type="date" name="sentOn" defaultValue={defaults.sentOn ?? ""} className={fieldInputClass} />
          <span className="text-xs text-slate-400">
            Blank keeps it a draft. Backdate it when you&apos;re entering an RFI you already sent.
          </span>
        </label>
        <label className={labelClass}>
          Answer needed by
          <input type="date" name="dueBy" defaultValue={defaults.dueBy ?? ""} className={fieldInputClass} />
        </label>
        <label className={labelClass}>
          Drawing reference
          {/* Autocorrect off on both of these. A phone keyboard rewrites
              "A-501 / 3" and "09 21 16" into words it recognises, and a
              drawing reference that does not match the sheet is the one thing
              an RFI cannot afford to get wrong. */}
          <input
            type="text"
            name="drawingReference"
            autoCorrect="off"
            spellCheck={false}
            defaultValue={defaults.drawingReference ?? ""}
            placeholder="e.g. A-501 / 3"
            className={fieldInputClass}
          />
        </label>
        <label className={labelClass}>
          Spec section
          <input
            type="text"
            name="specSection"
            autoCorrect="off"
            spellCheck={false}
            defaultValue={defaults.specSection ?? ""}
            placeholder="e.g. 09 21 16"
            className={fieldInputClass}
          />
        </label>
      </div>
    </>
  );
}
