"use client";

import { inputClass, labelClass } from "@/components/RfiFields";

export const CONTACT_STATUS_OPTIONS = [
  { value: "PROSPECT", label: "Prospect" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
] as const;

export const CONTACT_TYPE_OPTIONS = [
  { value: "GENERAL_CONTRACTOR", label: "General contractor" },
  { value: "DEVELOPER", label: "Developer" },
  { value: "VENDOR", label: "Vendor" },
  { value: "SUBCONTRACTOR", label: "Subcontractor" },
] as const;

export type ContactDefaults = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: string;
  accountType: string | null;
};

/** The identity half of a contact, shared by create and the row/detail edit
 * so the three can't drift on field names or option lists. */
export function ContactFields({ defaults }: { defaults: ContactDefaults }) {
  return (
    <>
      <label className={labelClass}>
        Name
        <input name="name" required defaultValue={defaults.name} className={inputClass} />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Status
          <select name="status" defaultValue={defaults.status} className={inputClass}>
            {CONTACT_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Type
          <select name="accountType" defaultValue={defaults.accountType ?? ""} className={inputClass}>
            <option value="">Not classified</option>
            {CONTACT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Email
          <input name="email" type="email" defaultValue={defaults.email ?? ""} className={inputClass} />
        </label>
        <label className={labelClass}>
          Phone
          <input name="phone" defaultValue={defaults.phone ?? ""} className={inputClass} />
        </label>
      </div>

      <label className={labelClass}>
        Address
        <input name="address" defaultValue={defaults.address ?? ""} className={inputClass} />
      </label>
    </>
  );
}
