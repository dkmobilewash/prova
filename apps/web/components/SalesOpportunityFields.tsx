"use client";

import { inputClass, labelClass } from "@/components/RfiFields";

export const OPPORTUNITY_STAGE_OPTIONS = [
  { value: "NEW", label: "New" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "DEMO_SCHEDULED", label: "Demo scheduled" },
  { value: "TRIAL", label: "Trial" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
] as const;

export type SalesOpportunityDefaults = {
  stage: string;
  estimatedMrr: string | null;
  expectedCloseDate: string | null;
  notes: string | null;
};

/** Shared by create and edit so the two can't drift on field names. */
export function SalesOpportunityFields({ defaults }: { defaults: SalesOpportunityDefaults }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Stage
          <select name="stage" defaultValue={defaults.stage} className={inputClass}>
            {OPPORTUNITY_STAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Estimated MRR
          <input
            name="estimatedMrr"
            defaultValue={defaults.estimatedMrr ?? ""}
            placeholder="Optional"
            className={inputClass}
          />
        </label>
      </div>

      <label className={labelClass}>
        Expected close date
        <input
          type="date"
          name="expectedCloseDate"
          defaultValue={defaults.expectedCloseDate ?? ""}
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        Notes
        <textarea
          name="notes"
          rows={2}
          defaultValue={defaults.notes ?? ""}
          placeholder="Optional"
          className={inputClass}
        />
      </label>
    </>
  );
}
