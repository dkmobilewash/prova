"use client";

import { inputClass, labelClass } from "@/components/RfiFields";
import { OPPORTUNITY_STAGE_OPTIONS } from "@/lib/sales-stage-history";

export type SalesOpportunityDefaults = {
  stage: string;
  estimatedMrr: string | null;
  expectedCloseDate: string | null;
  notes: string | null;
  /**
   * The day the move being recorded happened. Defaulted by the PARENT to
   * localToday() rather than computed here — both call sites are forms
   * mounted by a click, so the user's calendar date is safe there, and
   * keeping the call in the parent means this component never has to be
   * trusted not to be server-rendered.
   */
  stageEffectiveOn: string;
};

/** Shared by create and edit so the two can't drift on field names. */
export function SalesOpportunityFields({
  defaults,
  mode,
}: {
  defaults: SalesOpportunityDefaults;
  mode: "create" | "edit";
}) {
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

      <div className="grid gap-3 sm:grid-cols-2">
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
          {mode === "create" ? "Reached this stage on" : "Stage moved on"}
          <input
            type="date"
            name="stageEffectiveOn"
            defaultValue={defaults.stageEffectiveOn}
            className={inputClass}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            {mode === "create"
              ? "The day the deal actually reached this stage — backdate it if it was not today."
              : "Only recorded if you change the stage above. Editing the amount is not a move."}
          </span>
        </label>
      </div>

      <label className={labelClass}>
        Why it moved
        <input
          name="stageNote"
          placeholder="Optional"
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
