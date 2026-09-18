"use client";

import { inputClass, labelClass } from "@/components/RfiFields";

export type ExperienceModRateDefaults = {
  effectiveDate: string | null;
  rate: string | null;
  source: string | null;
  sourceUrl: string | null;
  note: string | null;
};

/**
 * One mod rate's fields, shared by the create form and the inline row edit so
 * the two cannot drift.
 *
 * The effective date only appears on create. It is the identity of the row —
 * half its unique key — and the action refuses to move it, so offering the
 * control on an edit would be offering something that does nothing.
 *
 * The date has NO default, deliberately, not even today. It is the first day
 * of the policy year as printed on the worksheet, and the day somebody types
 * it in is almost never that day. A pre-filled date is one a hurried person
 * saves unread.
 */
export function ExperienceModRateFields({
  defaults,
  showEffectiveDate,
}: {
  defaults: ExperienceModRateDefaults;
  showEffectiveDate: boolean;
}) {
  return (
    <>
      {showEffectiveDate && (
        <label className={labelClass}>
          Effective date
          <input
            type="date"
            name="effectiveDate"
            required
            defaultValue={defaults.effectiveDate ?? ""}
            className={inputClass}
          />
          <span className="text-xs text-ink-muted">
            The first day of the policy year the rate applies to, as printed on the rating worksheet.
          </span>
        </label>
      )}

      <label className={labelClass}>
        Rate
        <input
          type="text"
          name="rate"
          required
          inputMode="decimal"
          placeholder="0.87"
          defaultValue={defaults.rate ?? ""}
          className={inputClass}
        />
        <span className="text-xs text-ink-muted">
          Exactly as the bureau issued it, as a decimal. If the worksheet shows 87%, enter 0.87.
        </span>
      </label>

      <label className={labelClass}>
        Issued by
        <input
          type="text"
          name="source"
          required
          placeholder="NCCI, WCIRB, or your carrier"
          defaultValue={defaults.source ?? ""}
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        Link to the worksheet (optional)
        <input
          type="url"
          name="sourceUrl"
          placeholder="https://"
          defaultValue={defaults.sourceUrl ?? ""}
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        Note (optional)
        <input type="text" name="note" defaultValue={defaults.note ?? ""} className={inputClass} />
      </label>
    </>
  );
}
