"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLineItemCatalogEntry } from "@/lib/actions";
import { TRADE_SCOPE_OPTIONS } from "@/lib/trade-scopes";

/**
 * Adding a catalog entry by hand.
 *
 * A client component so the refusals land on screen. There are two worth
 * seeing: a description that duplicates an entry already in the catalog,
 * and a price field with something in it that isn't a number. Both used to
 * throw, and a thrown Server Action message is a digest in production.
 */

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-slate-300";

export type CraftOption = { id: string; label: string };

export function CatalogEntryForm({ craftOptions }: { craftOptions: CraftOption[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          try {
            const result = await createLineItemCatalogEntry(formData);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            formRef.current?.reset();
            router.refresh();
          } catch {
            setError("Could not add this entry");
          }
        });
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <label className="flex flex-1 min-w-[200px] flex-col gap-1 text-sm text-slate-300">
        Description
        <input name="description" required className={inputClass} />
      </label>
      <label className={labelClass}>
        Unit
        <input name="unit" placeholder="e.g. sq ft" className={`${inputClass} w-28`} />
      </label>
      <label className={labelClass}>
        Default unit price
        <input name="defaultUnitPrice" placeholder="optional" className={`${inputClass} w-32`} />
      </label>
      <label className={labelClass}>
        Default budgeted cost
        <input
          name="defaultBudgetedUnitCost"
          placeholder="optional"
          className={`${inputClass} w-32`}
        />
      </label>
      <label className={labelClass}>
        Default labor hrs
        <input name="defaultLaborHours" placeholder="optional" className={`${inputClass} w-28`} />
      </label>
      <label className={labelClass}>
        Trade
        <select name="tradeScope" defaultValue="" className={inputClass}>
          <option value="">No trade tag</option>
          {TRADE_SCOPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      {craftOptions.length > 0 && (
        <label className={labelClass}>
          Craft
          <select name="craftClassificationId" defaultValue="" className={inputClass}>
            <option value="">No craft tag</option>
            {craftOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? "Adding…" : "Add entry"}
      </button>
      {error && <p className="w-full text-sm text-red-400">{error}</p>}
    </form>
  );
}
