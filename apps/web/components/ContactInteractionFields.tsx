"use client";

import { inputClass, labelClass } from "@/components/RfiFields";

export const INTERACTION_TYPE_OPTIONS = [
  { value: "CALL", label: "Call" },
  { value: "EMAIL", label: "Email" },
  { value: "SITE_VISIT", label: "Site visit" },
  { value: "NOTE", label: "Note" },
] as const;

export type MemberOption = { id: string; name: string };

export type ContactInteractionDefaults = {
  type: string;
  occurredOn: string;
  summary: string;
  followUpOn: string | null;
  followUpAssignedToUserId: string | null;
};

/** Shared by create and edit so the two can't drift on field names or
 * option lists. */
export function ContactInteractionFields({
  defaults,
  members,
}: {
  defaults: ContactInteractionDefaults;
  members: MemberOption[];
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Type
          <select name="type" defaultValue={defaults.type} className={inputClass}>
            {INTERACTION_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Date
          <input
            type="date"
            name="occurredOn"
            required
            defaultValue={defaults.occurredOn}
            className={inputClass}
          />
          <span className="text-xs text-slate-500">
            The date it actually happened -- backdate one you&apos;re entering late.
          </span>
        </label>
      </div>

      <label className={labelClass}>
        Summary
        <textarea
          name="summary"
          required
          rows={2}
          defaultValue={defaults.summary}
          placeholder="What was discussed or decided"
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Follow-up date (optional)
          <input
            type="date"
            name="followUpOn"
            defaultValue={defaults.followUpOn ?? ""}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Follow-up owner
          <select
            name="followUpAssignedToUserId"
            defaultValue={defaults.followUpAssignedToUserId ?? ""}
            className={inputClass}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
