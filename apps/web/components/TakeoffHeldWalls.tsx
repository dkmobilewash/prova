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
}: {
  walls: readonly HeldWall[];
  /** Resolves to a sentence when it did not save. */
  onConfirm: (id: string) => Promise<string | null>;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (walls.length === 0) return null;
  const total = Math.round(walls.reduce((n, w) => n + w.feet, 0));
  async function confirm(id: string) {
    setSaving(id);
    setError(await onConfirm(id));
    setSaving(null);
  }
  return (
    <details className="shrink-0 text-xs text-ink-muted" data-takeoff="held-walls">
      <summary className="cursor-pointer text-ink-body">
        {walls.length} {walls.length === 1 ? "run" : "runs"} to confirm, {total.toLocaleString()} ft: not on the estimate
      </summary>
      {error !== null && <p className="text-tag-amber-ink">{error}</p>}
      <ul className="mt-1 flex max-h-40 flex-col gap-1 overflow-auto">
        {walls.map((wall) => (
          <li key={wall.id} className="flex items-center gap-2" data-takeoff="held-wall">
            <span>{Math.round(wall.feet)} ft</span>
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
  );
}
