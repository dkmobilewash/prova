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

export type ContactStandingTermsDefaults = {
  defaultRetainagePercent: string | null;
  paymentTermsDays: string | null;
  standardFormsUsed: string | null;
};

/**
 * The three "standing terms with this GC" fields that are genuinely often
 * already known about a GC before any job exists for them — retainage %,
 * payment terms and which subcontract form they use are typically the kind
 * of thing a sub already knows from having worked with (or bid to) this GC
 * before, not something that only accumulates after the fact.
 *
 * #218: reachable at creation as of this component existing, not just on
 * the edit path. defaultRetainagePercent in particular pre-fills
 * Job.retainagePercent on this contact's first job (see the comment on
 * that in lib/actions/jobs.ts) — a contact minted with it null defeats the
 * point of the pre-fill for exactly as long as it stays null, which used
 * to be "until someone remembers to go back and edit the contact."
 *
 * Deliberately does NOT include msaExpirationDate / prequalificationExpiresAt
 * — those record a specific document's expiration date, which does not
 * exist yet for a contact that doesn't have one on file (the common case
 * for a freshly added PROSPECT). Those stay edit-only, inline in
 * ContactEditForm, with their own comment there.
 */
export function ContactStandingTermsFields({ defaults }: { defaults: ContactStandingTermsDefaults }) {
  return (
    <div className="flex flex-wrap gap-3">
      <label className={labelClass}>
        Default retainage %
        <input
          name="defaultRetainagePercent"
          defaultValue={defaults.defaultRetainagePercent ?? ""}
          placeholder="e.g. 10"
          className={`w-32 ${inputClass}`}
        />
      </label>
      <label className={labelClass}>
        Payment terms (days)
        <input
          name="paymentTermsDays"
          defaultValue={defaults.paymentTermsDays ?? ""}
          placeholder="e.g. 30"
          className={`w-32 ${inputClass}`}
        />
      </label>
      <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm text-slate-300">
        Standard forms used
        <input
          name="standardFormsUsed"
          defaultValue={defaults.standardFormsUsed ?? ""}
          placeholder="e.g. AIA A401"
          className={inputClass}
        />
      </label>
    </div>
  );
}
