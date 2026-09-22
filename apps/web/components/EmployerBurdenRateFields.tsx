"use client";

import { inputClass, labelClass } from "@/components/RfiFields";

export type EmployerBurdenRateDefaults = {
  effectiveDate: string | null;
  percent: string | null;
  note: string | null;
};

/**
 * One employer-burden rate's fields, shared by the create form and the inline
 * row edit so the two cannot drift.
 *
 * The effective date only appears on create. It is the identity of the row —
 * half its unique key — and the action refuses to move it, so offering the
 * control on an edit would be offering something that does nothing. Moving it
 * would also silently re-cost hours in a period nobody asked about.
 *
 * The date has NO default, deliberately, not even today: it is the day the
 * percentage starts applying from, which is almost never the day somebody
 * types it in. A pre-filled date is one a hurried person saves unread.
 *
 * The percentage is `type="text"` with `inputMode="decimal"`, this app's
 * number-input convention (#414) — a `type="number"` scrolls its own value
 * under a trackpad and swallows what a person typed.
 */
export function EmployerBurdenRateFields({
  defaults,
  showEffectiveDate,
}: {
  defaults: EmployerBurdenRateDefaults;
  showEffectiveDate: boolean;
}) {
  return (
    <>
      {showEffectiveDate && (
        <label className={labelClass}>
          Effective from
          <input
            type="date"
            name="effectiveDate"
            required
            defaultValue={defaults.effectiveDate ?? ""}
            className={inputClass}
          />
          <span className="text-xs text-ink-muted">
            The first day this percentage applies to. Hours worked before it keep the rate that was
            in force on the day they were worked.
          </span>
        </label>
      )}

      <label className={labelClass}>
        Employer burden
        <input
          type="text"
          name="percent"
          required
          inputMode="decimal"
          placeholder="18.5"
          defaultValue={defaults.percent ?? ""}
          className={inputClass}
        />
        <span className="text-xs text-ink-muted">
          A percentage of the base wage — enter 18.5 for 18.5%, not 0.185. Employer FICA, FUTA and
          state unemployment, and workers&apos; comp premium: what an hour costs you beyond the wage
          and the fringes you already pay.
        </span>
      </label>

      <label className={labelClass}>
        What it covers (optional)
        <input
          type="text"
          name="note"
          placeholder="FICA 7.65, FUTA/SUTA 2.1, comp 9.4 — per 2026 CPA review"
          defaultValue={defaults.note ?? ""}
          className={inputClass}
        />
        <span className="text-xs text-ink-muted">
          Never parsed by the app. It is here because a bare number a year from now is a number
          nobody can defend to a GC.
        </span>
      </label>
    </>
  );
}
