"use client";

import { useState } from "react";
import { Spinner } from "@/components/Spinner";

export type HeldWall = { id: string; feet: number };

/**
 * Walls the model doubts, on the sheet and off the estimate. On the page and
 * not in the Quantities panel, so the footage left out is never out of sight.
 */
export function TakeoffHeldWalls({
  walls,
  onConfirm,
  asRow = false,
  defaultOpen = false,
  onHover,
  onShow,
  needsLook = 0,
}: {
  walls: readonly HeldWall[];
  /** A person's decisions (kept, dropped, typed) on walls this reading no longer finds: kept as they were. */
  needsLook?: number;
  /** The workspace's layer panel: one "Needs review" row that opens in place. */
  asRow?: boolean;
  /** Starts open: opened from the job stepper's Review. */
  defaultOpen?: boolean;
  /** Pointing at a run picks it out on the plan; null when the pointer leaves. */
  onHover?: (id: string | null) => void;
  /** Takes the plan to the run: zoomed in and centred. */
  onShow?: (id: string) => void;
  /** Resolves to a sentence when it did not save. */
  onConfirm: (id: string) => Promise<string | null>;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const look =
    needsLook > 0 ? (
      <p className="shrink-0 text-xs text-tag-amber-ink" data-takeoff="needs-a-look">
        {needsLook} of your decisions {needsLook === 1 ? "is" : "are"} on {needsLook === 1 ? "a wall" : "walls"} this reading no longer finds. Kept as you left {needsLook === 1 ? "it" : "them"}: needs a look.
      </p>
    ) : null;
  if (walls.length === 0) return look;
  const total = Math.round(walls.reduce((n, w) => n + w.feet, 0));
  async function confirm(id: string) {
    setSaving(id);
    setError(await onConfirm(id));
    setSaving(null);
  }
  return (
    <>
    {look}
    <details
      open={defaultOpen || undefined}
      className={`shrink-0 text-xs text-ink-muted${asRow ? " rounded-md px-1.5 py-1.5 hover:bg-rail" : ""}`}
      data-takeoff="held-walls"
    >
      <summary className="cursor-pointer text-ink-body">
        {/* As a layer row: the same swatch, name, count and total columns. */}
        {asRow && (
          <span className="inline-flex w-[calc(100%-1rem)] items-center gap-2" data-takeoff="needs-review-row">
            <span aria-hidden className="h-2.5 w-4 shrink-0 rounded-sm bg-bar-amber" />
            <span className="min-w-0 flex-1 truncate font-medium text-tag-amber-ink">Needs review</span>
            <span className="shrink-0 rounded bg-rail px-1 text-[10px] text-ink-muted">{walls.length}</span>
            <span className="w-20 shrink-0 text-right tabular-nums text-ink-body">{total.toLocaleString()} ft</span>
          </span>
        )}
        <span className={asRow ? "block pl-10 font-normal text-ink-muted" : undefined}>
          {walls.length} {walls.length === 1 ? "run" : "runs"} to confirm, {total.toLocaleString()} ft: not on the estimate
        </span>
      </summary>
      {error !== null && <p className="text-tag-amber-ink">{error}</p>}
      <ul className="mt-1 flex max-h-40 flex-col gap-1 overflow-auto">
        {walls.map((wall) => (
          <li
            key={wall.id}
            className="flex items-center gap-2 rounded px-1 hover:bg-rail-hover"
            data-takeoff="held-wall"
            onMouseEnter={() => onHover?.(wall.id)}
            onMouseLeave={() => onHover?.(null)}
          >
            {onShow ? (
              <button
                type="button"
                onClick={() => onShow(wall.id)}
                aria-label={`Show the ${Math.round(wall.feet)} ft run on the plan`}
                title="Zoom to it on the plan"
                className="tabular-nums text-ink-body underline decoration-dotted hover:text-ink"
                data-takeoff="show-held-wall"
              >
                {Math.round(wall.feet)} ft
              </button>
            ) : (
              <span>{Math.round(wall.feet)} ft</span>
            )}
            <button type="button" disabled={saving !== null} onClick={() => void confirm(wall.id)} className="underline hover:text-ink-body" data-takeoff="confirm-held-wall">
              {saving === wall.id ? (
                <>
                  <Spinner /> Saving…
                </>
              ) : (
                "It is a wall"
              )}
            </button>
          </li>
        ))}
      </ul>
    </details>
    </>
  );
}
