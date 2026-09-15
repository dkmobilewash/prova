"use client";

// 16px, not the 14px inherited from the `text-sm` label: iOS Safari zooms the
// whole page when a focused input is under 16px, which leaves the page zoomed
// and scrolled sideways after every tap. `min-h-11` is a 44px tap target.
const inputClass =
  "min-h-11 rounded-md border border-line-card bg-canvas px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-ink-label";

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
