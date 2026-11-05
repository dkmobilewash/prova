"use client";

import { useState } from "react";
import { parseFeetInches } from "@/lib/feet-inches";
import { feetLabel, type HeightOption } from "@/lib/takeoff/wallHeight";

/**
 * ── "SET HEIGHT", FOR A WALL GROUP WITH NONE ──
 *
 * One press per figure the job already has — the ceiling over the rooms the
 * walls bound, the type's legend height — or a typed one (`10'-0"`, `10.5`).
 * Whatever is chosen goes on the group's item for the whole job
 * (`setWallGroupHeight`); `onSet` returns a sentence when it did not save.
 */
export function SetWallHeight({ options, onSet, name }: { options: readonly HeightOption[]; onSet: (feet: number) => Promise<string | null>; name: string }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function set(feet: number) {
    setBusy(true);
    setError(null);
    const problem = await onSet(feet);
    setBusy(false);
    setError(problem);
  }
  const button = "min-h-[28px] rounded-md border border-line-card bg-surface px-2 text-xs font-medium text-ink-body hover:bg-rail-hover disabled:opacity-50";
  return (
    <span className="flex flex-wrap items-center gap-1" data-takeoff="set-height" onClick={(event) => event.stopPropagation()}>
      <span className="text-xs text-ink-muted">Set height</span>
      {options.map((option) => (
        <button
          key={option.kind}
          type="button"
          className={button}
          disabled={busy}
          title={option.from}
          aria-label={`Set the height of ${name} to ${feetLabel(option.feet)}, from the ${option.kind === "ceiling" ? "ceiling" : "legend"}`}
          data-takeoff={`set-height-${option.kind}`}
          onClick={() => void set(option.feet)}
        >
          {option.kind === "ceiling" ? "Ceiling" : "Legend"} {feetLabel(option.feet)}
        </button>
      ))}
      <form
        className="flex items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = parseFeetInches(typed, { label: "Height", min: 0 });
          if (!parsed.ok) return setError(parsed.error);
          void set(parsed.n);
        }}
      >
        <input
          inputMode="decimal"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={`10'-0"`}
          aria-label={`Height of ${name}`}
          data-takeoff="set-height-typed"
          className="w-16 rounded-md border border-line-card bg-surface px-1.5 py-0.5 text-xs text-ink-body"
        />
        <button type="submit" className={button} disabled={busy || typed.trim() === ""} aria-label={`Save the height of ${name}`} data-takeoff="set-height-save">
          Save
        </button>
      </form>
      {error !== null && (
        <span role="alert" className="text-xs text-tag-rose-ink">
          {error}
        </span>
      )}
    </span>
  );
}
