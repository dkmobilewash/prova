"use client";

import { useState } from "react";
import { money } from "@/lib/money";

/**
 * The labor-hours and craft fields on the add-line-item form, with a live
 * burdened-cost hint.
 *
 * These two inputs live in a client component so the hint can price hours as
 * they're typed. Burden is linear in hours, so the server sends one burdened
 * rate per craft — computed by the same function that prices a saved line —
 * and this multiplies. No round trip, and no second implementation of the
 * burden math that could disagree with the row this form creates.
 *
 * The inputs keep their original `name`s and stay inside the same `<form>`,
 * so the server action receives exactly what it did before.
 */

export type CraftOption = {
  id: string;
  label: string;
  /** Burdened cost of one hour, or null when no fringe schedule is effective
   * for this craft on the job's pricing date. */
  hourlyRate: number | null;
};

const inputClass =
  "rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";

export function LaborHoursField({ crafts }: { crafts: CraftOption[] }) {
  const [hours, setHours] = useState("");
  const [craftId, setCraftId] = useState("");

  const craft = crafts.find((option) => option.id === craftId) ?? null;
  const parsedHours = Number(hours);
  const hasHours = hours.trim() !== "" && Number.isFinite(parsedHours) && parsedHours > 0;

  // Every "nothing to show" case is distinct, and saying which one it is
  // beats a blank space the user can't interpret. None of them guess a rate:
  // no effective schedule means no number, same rule the saved line follows.
  let hint: string | null = null;
  if (hasHours && craft && craft.hourlyRate !== null) {
    hint = `≈ ${money(parsedHours * craft.hourlyRate)} labor`;
  } else if (hasHours && craft && craft.hourlyRate === null) {
    hint = "No wage rate on file for that craft on this job's dates";
  } else if (hasHours && !craft) {
    hint = "Pick a craft to price these hours";
  }

  return (
    <>
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Labor hrs
        <input
          name="laborHours"
          value={hours}
          onChange={(event) => setHours(event.target.value)}
          placeholder="hrs"
          inputMode="decimal"
          className={`w-20 ${inputClass}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-300">
        Craft
        <select
          name="craftClassificationId"
          value={craftId}
          onChange={(event) => setCraftId(event.target.value)}
          className={inputClass}
        >
          <option value="">No craft tag</option>
          {crafts.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {hint && (
        <p
          className="self-end pb-2 text-xs text-slate-400"
          title="Burdened labor: base wage plus fringes, at straight time. An estimate only — it is never written into the line's budgeted cost."
        >
          {hint}
        </p>
      )}
    </>
  );
}
