"use client";

// 16px, not the 14px inherited from the `text-sm` label: iOS Safari zooms the
// whole page when a focused input is under 16px, which leaves the page zoomed
// and scrolled sideways after every tap. `min-h-11` is a 44px tap target.
const inputClass =
  "min-h-11 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-base text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

export type EquipmentFieldValues = {
  name: string;
  type: string | null;
  assetTag: string | null;
  assignedJobId: string | null;
  notes: string | null;
};

export type JobOption = { id: string; name: string };

/** Shared by the create form and the inline edit form, same as
 * VendorFields — one definition so the two can't drift apart. */
export function EquipmentFields({
  jobs,
  defaults,
}: {
  jobs: JobOption[];
  defaults?: Partial<EquipmentFieldValues>;
}) {
  return (
    <>
      <label className={labelClass}>
        Name
        <input
          type="text"
          name="name"
          required
          defaultValue={defaults?.name ?? ""}
          placeholder="e.g. Genie S-45 boom lift"
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Type
          <input
            type="text"
            name="type"
            defaultValue={defaults?.type ?? ""}
            placeholder="Lift, scaffolding, mixer…"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Asset tag or serial
          {/* Autocorrect off: a phone keyboard rewrites a serial like
              "AT-11492b" into a word it recognises, and the whole point of
              the field is that it matches the sticker on the machine. */}
          <input
            type="text"
            name="assetTag"
            autoCorrect="off"
            spellCheck={false}
            defaultValue={defaults?.assetTag ?? ""}
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        Currently on
        <select name="assignedJobId" defaultValue={defaults?.assignedJobId ?? ""} className={inputClass}>
          <option value="">In the yard / unassigned</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name}
            </option>
          ))}
        </select>
      </label>

      <label className={labelClass}>
        Notes
        <textarea
          name="notes"
          rows={2}
          defaultValue={defaults?.notes ?? ""}
          placeholder="Condition, service due, who has the key"
          className={inputClass}
        />
      </label>
    </>
  );
}
