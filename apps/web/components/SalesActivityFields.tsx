"use client";

import { inputClass, labelClass } from "@/components/RfiFields";

export const SALES_ACTIVITY_TYPE_OPTIONS = [
  { value: "CALL", label: "Call" },
  { value: "EMAIL", label: "Email" },
  { value: "DEMO", label: "Demo" },
  { value: "MEETING", label: "Meeting" },
  { value: "NOTE", label: "Note" },
] as const;

export type SalesActivityDefaults = {
  type: string;
  occurredOn: string;
  summary: string;
  followUpOn: string | null;
  opportunityId: string | null;
};

export type OpportunityOption = { id: string; label: string };

/** Shared by create and edit so the two can't drift on field names. */
export function SalesActivityFields({
  defaults,
  opportunityOptions,
}: {
  defaults: SalesActivityDefaults;
  opportunityOptions: readonly OpportunityOption[];
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          What happened
          <select name="type" defaultValue={defaults.type} className={inputClass}>
            {SALES_ACTIVITY_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Date it happened
          <input type="date" name="occurredOn" defaultValue={defaults.occurredOn} className={inputClass} />
        </label>
      </div>

      <label className={labelClass}>
        Summary
        <textarea
          name="summary"
          rows={2}
          defaultValue={defaults.summary}
          placeholder="What was said"
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Follow up on
          <input
            type="date"
            name="followUpOn"
            defaultValue={defaults.followUpOn ?? ""}
            className={inputClass}
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            Leave blank if nothing is owed. This replaces whatever the lead owed before.
          </span>
        </label>

        {opportunityOptions.length > 0 && (
          <label className={labelClass}>
            About which deal
            <select
              name="opportunityId"
              defaultValue={defaults.opportunityId ?? ""}
              className={inputClass}
            >
              <option value="">Not about a specific deal</option>
              {opportunityOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </>
  );
}
