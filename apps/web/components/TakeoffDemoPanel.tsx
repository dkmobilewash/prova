"use client";

import { useState, useTransition } from "react";
import { saveDemoTakeoff } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";
import type { DemoSheet } from "@/lib/takeoff/demoWalls";

/** What a demolition sheet reads: every run can be unticked before it is saved, because this is a proposal. */
export function TakeoffDemoPanel({
  jobId,
  pageId,
  state,
  dropped,
  onToggle,
  onClear,
  onSaved,
}: {
  jobId: string;
  pageId: string;
  state: { read: DemoSheet | null; busy: boolean; error: string | null };
  dropped: ReadonlySet<number>;
  onToggle: (index: number) => void;
  onClear: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  if (state.busy) return <p className="mb-2 flex items-center gap-2 rounded-lg border border-line-card bg-surface p-3 text-xs text-ink-body"><Spinner /> Reading the sheet for demolition…</p>;
  if (state.error || state.read === null) return <p className="mb-2 rounded-lg border border-line-card bg-surface p-3 text-xs text-tag-rose-ink">{state.error ?? "The sheet could not be read."}</p>;
  const { runs, doors, doorsTypical } = state.read;
  const kept = runs.filter((_, i) => !dropped.has(i));
  const feet = kept.reduce((n, r) => n + r.lengthFeet, 0);
  const save = () =>
    startTransition(async () => {
      const result = await saveDemoTakeoff(jobId, pageId, { walls: kept.map(({ x1, y1, x2, y2, tag }) => ({ x1, y1, x2, y2, tag: tag ?? null })), doors: doors.map(({ x, y }) => ({ x, y })) });
      if (!result.ok) return setError(result.error);
      onSaved();
    });
  return (
    <div data-takeoff="demo-panel" className="mb-2 rounded-lg border border-line-card bg-surface p-3 text-xs">
      <p className="text-sm font-medium text-ink" data-takeoff="demo-total">
        {kept.length} {kept.length === 1 ? "wall" : "walls"} to remove, {Math.round(feet)} ft · {doors.length} {doors.length === 1 ? "door" : "doors"}
      </p>
      <p className="mt-1 text-ink-muted">Walls are read from double dashed lines and doors from the keynotes. Check them against the drawing. A typical floor is read once, so multiply it yourself.</p>
      {doorsTypical && <p className="mt-1 text-tag-amber-ink">A door keynote says TYP., so there are more doors than tags. Add the rest with Count.</p>}
      {doors.length === 0 && <p className="mt-1 text-tag-amber-ink">No keynote names a door to remove. Count any by hand.</p>}
      {runs.length > 0 && (
        <ul className="mt-2 max-h-40 overflow-y-auto">
          {runs.map((run, i) => (
            <li key={`${run.x1}:${run.y1}`}>
              <label className="flex min-h-[28px] items-center gap-2 text-ink-body">
                <input type="checkbox" checked={!dropped.has(i)} onChange={() => onToggle(i)} />
                {run.lengthFeet.toFixed(1)} ft · {run.thicknessIn.toFixed(1)} in{run.tag ? ` · ${run.tag}` : ""}
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-tag-rose-ink">{error}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={save} disabled={isPending || (kept.length === 0 && doors.length === 0)} data-takeoff="demo-save" className="min-h-[36px] rounded-md bg-brand px-3 font-medium text-neutral-900 disabled:opacity-50">
          Save to takeoff
        </button>
        <button type="button" onClick={onClear} className="text-ink-muted underline hover:text-ink-body">Clear</button>
      </div>
    </div>
  );
}
