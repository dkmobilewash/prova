"use client";

import { inputClass, labelClass } from "@/components/RfiFields";
import { EQUIPMENT_RATE_UNITS, type EquipmentRateRow } from "@/lib/equipment-rates";

/** Shared by the add form and the row edit, so the two cannot drift. The start date
 * has no default: it is rarely the day somebody types it in. */
export function EquipmentRateFields({ defaults }: { defaults?: EquipmentRateRow }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className={labelClass}>
        Equipment
        <input name="name" required defaultValue={defaults?.name} placeholder="e.g. 19ft scissor lift" className={inputClass} />
      </label>
      <label className={labelClass}>
        Per
        <select name="unit" defaultValue={defaults?.unit ?? "DAY"} className={inputClass}>
          {EQUIPMENT_RATE_UNITS.map((unit) => (
            <option key={unit.value} value={unit.value}>
              {unit.label}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Cost to you ($)
        <input name="rate" type="text" inputMode="decimal" required defaultValue={defaults?.rate.toFixed(2)} className={inputClass} />
      </label>
      <label className={labelClass}>
        Starts
        <input name="effectiveFrom" type="date" required defaultValue={defaults?.effectiveFrom} className={inputClass} />
      </label>
      <label className={labelClass}>
        Ends (optional)
        <input name="effectiveTo" type="date" defaultValue={defaults?.effectiveTo ?? ""} className={inputClass} />
      </label>
      <label className={labelClass}>
        Notes (optional)
        <input name="notes" defaultValue={defaults?.notes ?? ""} className={inputClass} />
      </label>
    </div>
  );
}
