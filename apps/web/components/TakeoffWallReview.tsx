"use client";

import { useEffect } from "react";

/**
 * "Review walls": one run at a time, most doubted first. K keeps, D drops, U
 * takes the last decision back. The keys are caught before the workspace sees
 * them, because there K is the previous page.
 */
export function TakeoffWallReview({
  counter,
  current,
  busy,
  error,
  onKeep,
  onDrop,
  onUndo,
  onClose,
}: {
  counter: string;
  /** The run on screen, or null when every run is decided. */
  current: { feet: number; why: string } | null;
  busy: boolean;
  error: string | null;
  onKeep: () => void;
  onDrop: () => void;
  onUndo: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const act = key === "k" ? onKeep : key === "d" ? onDrop : key === "u" ? onUndo : key === "escape" ? onClose : null;
      if (act === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!busy || key === "escape") act();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onKeep, onDrop, onUndo, onClose]);

  const button = "min-h-[32px] rounded-md border border-line-card px-3 text-xs font-medium text-ink-body hover:bg-rail disabled:opacity-50";
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-body" data-takeoff="wall-review">
      <span className="font-semibold" data-takeoff="review-counter">
        {counter}
      </span>
      {current === null ? (
        <span>Every run is reviewed.</span>
      ) : (
        <>
          <span>
            {Math.round(current.feet)} ft · {current.why}
          </span>
          <button type="button" className={button} disabled={busy} onClick={onKeep} data-takeoff="review-keep">
            Keep (K)
          </button>
          <button type="button" className={button} disabled={busy} onClick={onDrop} data-takeoff="review-drop">
            Drop (D)
          </button>
        </>
      )}
      <button type="button" className={button} disabled={busy} onClick={onUndo} data-takeoff="review-undo">
        Undo (U)
      </button>
      <button type="button" className="underline" onClick={onClose} data-takeoff="review-close">
        Done
      </button>
      {error !== null && <span className="text-tag-amber-ink">{error}</span>}
    </div>
  );
}
