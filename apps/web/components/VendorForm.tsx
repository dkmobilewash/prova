"use client";

import { useRef, useState, useTransition } from "react";
import { createVendor } from "@/lib/actions";
import { TRADE_SCOPE_LABELS } from "@/components/tradeScopeLabels";

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

export function VendorForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await createVendor(formData);
        formRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save vendor");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className={labelClass}>
        Vendor name
        <input type="text" name="name" required placeholder="e.g. Westside Building Supply" className={inputClass} />
      </label>

      <label className={labelClass}>
        Trade supplied (optional)
        <select name="tradeScope" defaultValue="" className={inputClass}>
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
          <input type="text" name="contactName" className={inputClass} />
        </label>
        <label className={labelClass}>
          Phone
          <input type="tel" name="phone" className={inputClass} />
        </label>
      </div>

      <label className={labelClass}>
        Email
        <input type="email" name="email" className={inputClass} />
      </label>

      <label className={labelClass}>
        Notes
        <textarea name="notes" rows={2} placeholder="Account number, delivery lead time, who to ask for" className={inputClass} />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Add vendor"}
      </button>
    </form>
  );
}
