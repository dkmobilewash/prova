"use client";

import { inputClass, labelClass } from "@/components/RfiFields";

export const SALES_LEAD_SOURCE_OPTIONS = [
  { value: "REFERRAL", label: "Referral" },
  { value: "OUTBOUND", label: "Outbound" },
  { value: "INBOUND", label: "Inbound" },
  { value: "EVENT", label: "Event" },
  { value: "OTHER", label: "Other" },
] as const;

export type SalesLeadDefaults = {
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
};

/** Shared by create and edit so the two can't drift on field names. */
export function SalesLeadFields({ defaults }: { defaults: SalesLeadDefaults }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Company name
          <input name="companyName" required defaultValue={defaults.companyName} className={inputClass} />
        </label>
        <label className={labelClass}>
          Contact name
          <input name="contactName" defaultValue={defaults.contactName ?? ""} className={inputClass} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Email
          <input type="email" name="email" defaultValue={defaults.email ?? ""} className={inputClass} />
        </label>
        <label className={labelClass}>
          Phone
          <input name="phone" defaultValue={defaults.phone ?? ""} className={inputClass} />
        </label>
      </div>

      <label className={labelClass}>
        Source
        <select name="source" defaultValue={defaults.source ?? ""} className={inputClass}>
          <option value="">Not recorded</option>
          {SALES_LEAD_SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
