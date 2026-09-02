"use client";

import { useState, useTransition } from "react";
import { setCraftTier } from "@/lib/actions";

const TIER_LABELS: Record<string, string> = {
  JOURNEYMAN: "Journeyman",
  APPRENTICE: "Apprentice",
  FOREMAN: "Foreman",
};

/** Records which side of a ratio a classification sits on.
 *
 * Saves on change, and says plainly that leaving it unset is not neutral:
 * hours on an unclassified craft make a day read INCOMPLETE rather than
 * compliant, which is the behaviour that stops a half-configured company
 * getting a clean bill of health. */
export function CraftTierPicker({
  craftId,
  tier,
  apprenticePeriod,
}: {
  craftId: string;
  tier: string | null;
  apprenticePeriod: number | null;
}) {
  const [value, setValue] = useState(tier ?? "");
  const [period, setPeriod] = useState(apprenticePeriod === null ? "" : String(apprenticePeriod));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(nextTier: string, nextPeriod: string) {
    setError(null);
    const formData = new FormData();
    formData.set("tier", nextTier);
    formData.set("apprenticePeriod", nextPeriod);
    startTransition(async () => {
      const result = await setCraftTier(craftId, formData);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <select
          value={value}
          disabled={isPending}
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
            const nextPeriod = next === "APPRENTICE" ? period : "";
            setPeriod(nextPeriod);
            save(next, nextPeriod);
          }}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 disabled:opacity-50"
        >
          <option value="">Not classified</option>
          {Object.entries(TIER_LABELS).map(([tierValue, label]) => (
            <option key={tierValue} value={tierValue}>
              {label}
            </option>
          ))}
        </select>

        {value === "APPRENTICE" && (
          <input
            type="number"
            min="1"
            max="10"
            step="1"
            value={period}
            disabled={isPending}
            placeholder="period"
            onChange={(event) => setPeriod(event.target.value)}
            onBlur={() => save(value, period)}
            className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 disabled:opacity-50"
          />
        )}
      </div>

      {value === "" && (
        <p className="text-xs text-amber-300">Hours on this craft can&apos;t be counted either way</p>
      )}
      {error && <p className="max-w-[16rem] text-right text-xs text-red-400">{error}</p>}
    </div>
  );
}
