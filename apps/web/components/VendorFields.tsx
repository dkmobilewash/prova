"use client";

import { TRADE_SCOPE_LABELS } from "@/components/tradeScopeLabels";

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

export type VendorFieldValues = {
  name: string;
  tradeScope: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

/** The vendor field set, shared by the create form and the inline edit
 * form so the two can't drift apart. Uncontrolled inputs with
 * defaultValue — the server action reads the FormData, nothing here
 * needs to track keystrokes. */
export function VendorFields({ defaults }: { defaults?: Partial<VendorFieldValues> }) {
  return (
    <>
      <label className={labelClass}>
        Vendor name
        <input
          type="text"
          name="name"
          required
          defaultValue={defaults?.name ?? ""}
          placeholder="e.g. Westside Building Supply"
          className={inputClass}
        />
      </label>

      <label className={labelClass}>
        Trade supplied (optional)
        <select name="tradeScope" defaultValue={defaults?.tradeScope ?? ""} className={inputClass}>
          <option value="">Any / not specific</option>
          {TRADE_SCOPE_LABELS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Contact name
          <input type="text" name="contactName" defaultValue={defaults?.contactName ?? ""} className={inputClass} />
        </label>
        <label className={labelClass}>
          Phone
          <input type="tel" name="phone" defaultValue={defaults?.phone ?? ""} className={inputClass} />
        </label>
      </div>

      <label className={labelClass}>
        Email
        <input type="email" name="email" defaultValue={defaults?.email ?? ""} className={inputClass} />
      </label>

      <label className={labelClass}>
        Notes
        <textarea
          name="notes"
          rows={2}
          defaultValue={defaults?.notes ?? ""}
          placeholder="Account number, delivery lead time, who to ask for"
          className={inputClass}
        />
      </label>
    </>
  );
}
