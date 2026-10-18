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
  /** The CSLB licence number, bare digits — 2 to 7 of them, which is what
   *  California's own licence file holds. The key a public-register lookup joins
   *  on, which is why it is typeable here and not import-only: an import can put
   *  the wrong one on a lead, and a join key nobody can correct looks up as
   *  somebody else for good. */
  licenceNumber: string | null;
  city: string | null;
  /** The firm's domain, bare — "bakerdrywall.com". Optional because the
   *  create form starts blank; the email finder writes it too. */
  website?: string | null;
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

      {/* The two listing columns a person can also know. The other three —
          DIR registration, the GC that listed them, the project — are
          provenance written by the import and are deliberately not editable;
          see `readListingFields` in lib/actions/sales.ts. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          CSLB licence number
          <input
            name="licenceNumber"
            inputMode="numeric"
            defaultValue={defaults.licenceNumber ?? ""}
            className={inputClass}
          />
          <span className="mt-1 block text-xs font-normal text-ink-muted">
            Two to seven digits — that is what California&apos;s own licence file
            holds. A class in front of it (&ldquo;C-9 884201&rdquo;) and leading
            zeros are both fine; they are stripped. This is the number a
            public-register lookup joins on, so leave it blank rather than
            guessing.
          </span>
        </label>
        <label className={labelClass}>
          City
          <input name="city" defaultValue={defaults.city ?? ""} className={inputClass} />
        </label>
      </div>

      <label className={labelClass}>
        Website
        <input name="website" defaultValue={defaults.website ?? ""} placeholder="bakerdrywall.com" className={inputClass} />
        <span className="mt-1 block text-xs font-normal text-ink-muted">
          The domain they gave you on the phone. Find email reads this site first instead of
          searching for one.
        </span>
      </label>

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
