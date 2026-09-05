"use client";

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

export type EquipmentFieldValues = {
  name: string;
  type: string | null;
  assetTag: string | null;
  notes: string | null;
};

/** Shared by the create form and the inline edit form, same as
 * VendorFields — one definition so the two can't drift apart. */
export function EquipmentFields({ defaults }: { defaults?: Partial<EquipmentFieldValues> }) {
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
          <input type="text" name="assetTag" defaultValue={defaults?.assetTag ?? ""} className={inputClass} />
        </label>
      </div>

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
