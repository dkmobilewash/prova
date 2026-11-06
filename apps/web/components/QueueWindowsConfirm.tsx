"use client";

import { useEffect, useRef, useState } from "react";
import type { ReviewItem } from "@/lib/takeoff/reviewQueue";

type WindowsItem = Extract<ReviewItem, { kind: "windows" }>;

/**
 * ── A SHEET'S COUNTED WINDOWS IN THE REVIEW QUEUE, CONFIRMED AS ONE COUNT ──
 *
 * Every window found is lit on the plan; the count and its types are shown,
 * and nothing is on the estimate until Enter. A false hit — casework, a
 * sliding door drawn like a window — goes with one key:
 *
 *   Enter      confirm the windows still lit
 *   ← / →      zoom to the previous / next window
 *   D or Del   drop the window zoomed to (the first one if none is)
 *   N          skip to the next item
 *
 * Keys are taken in the capture phase, as `QueueGroupConfirm` takes them.
 */
export function QueueWindowsConfirm({
  item,
  onShow,
  onAccept,
  onSkip,
}: {
  item: WindowsItem;
  /** The windows still lit and the one zoomed to, for the plan. */
  onShow: (item: WindowsItem) => void;
  /** The kept windows, as indexes into `item.runs`. */
  onAccept: (kept: number[]) => void;
  onSkip: () => void;
}) {
  const [dropped, setDropped] = useState<ReadonlySet<number>>(new Set());
  // An index into the kept windows, or null while all are shown.
  const [at, setAt] = useState<number | null>(null);
  const kept = item.runs.map((_, i) => i).filter((i) => !dropped.has(i));

  useEffect(() => {
    onShow({ ...item, runs: kept.map((i) => item.runs[i]!), tags: kept.map((i) => item.tags[i]!), at });
  }, [dropped, at]); // eslint-disable-line react-hooks/exhaustive-deps -- what is lit follows the decisions, nothing else

  const step = (by: number) => {
    if (kept.length === 0) return;
    setAt((was) => (was === null ? (by > 0 ? 0 : kept.length - 1) : (was + by + kept.length) % kept.length));
  };
  const drop = () => {
    const target = kept[at ?? 0];
    if (target === undefined) return;
    setDropped((was) => new Set(was).add(target));
    // Stay on the window that slid into this place; none left shows them all.
    setAt((was) => (kept.length <= 1 ? null : Math.min(was ?? 0, kept.length - 2)));
  };

  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
    const key = event.key;
    if (key === "Enter") onAccept(kept);
    else if (key === "ArrowRight") step(1);
    else if (key === "ArrowLeft") step(-1);
    else if (key === "d" || key === "D" || key === "Delete" || key === "Backspace") drop();
    else if (key === "n" || key === "N") onSkip();
    else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);

  const byTag = new Map<string, number>();
  for (const i of kept) byTag.set(item.tags[i]!, (byTag.get(item.tags[i]!) ?? 0) + 1);
  const types = [...byTag].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([tag, n]) => `${tag} ×${n}`).join(", ");
  const current = at === null ? null : kept[at];
  const button = "min-h-[28px] rounded-md border border-line-card px-2 text-xs font-medium text-ink-body hover:bg-rail disabled:opacity-50";
  return (
    <span className="contents" data-takeoff="queue-windows">
      <span className="font-medium" data-takeoff="queue-windows-count">
        {kept.length} {kept.length === 1 ? "window" : "windows"} · sheet {item.sheet}
        {types !== "" && ` · ${types}`}
      </span>
      <span className="text-ink-muted">
        Counted by opening, typed by the nearest tag
        {dropped.size > 0 && ` · ${dropped.size} dropped`}
        {current !== null && current !== undefined && ` · looking at ${at! + 1} of ${kept.length} (${item.tags[current]})`}
      </span>
      <button type="button" className={`${button} border-brand bg-brand font-semibold text-neutral-900`} onClick={() => onAccept(kept)} data-takeoff="queue-windows-accept">
        Confirm {kept.length} ⏎
      </button>
      <button type="button" className={button} onClick={() => step(1)} data-takeoff="queue-windows-next">
        Next window →
      </button>
      <button type="button" className={button} onClick={drop} disabled={kept.length === 0} data-takeoff="queue-windows-drop">
        Not a window (D)
      </button>
    </span>
  );
}
