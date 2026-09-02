"use client";

import { useState, useTransition } from "react";
import { setDeterminationRuleSet } from "@/lib/actions";

/** Attaches a rule set to a job's wage determination.
 *
 * Saves on change and reports its own failure inline, so an attachment
 * that was refused is visible rather than a select that silently springs
 * back. */
export function DeterminationRuleSetPicker({
  determinationId,
  current,
  options,
}: {
  determinationId: string;
  current: string | null;
  options: { id: string; name: string; jurisdiction: string }[];
}) {
  const [value, setValue] = useState(current ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={value}
        disabled={isPending}
        onChange={(event) => {
          const next = event.target.value;
          const previous = value;
          setValue(next);
          setError(null);
          const formData = new FormData();
          formData.set("ruleSetId", next);
          startTransition(async () => {
            const result = await setDeterminationRuleSet(determinationId, formData);
            if (!result.ok) {
              setError(result.error);
              setValue(previous);
            }
          });
        }}
        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 disabled:opacity-50"
      >
        <option value="">No rules attached</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name} — {option.jurisdiction}
          </option>
        ))}
      </select>
      {error && <p className="max-w-[16rem] text-right text-xs text-red-400">{error}</p>}
    </div>
  );
}
