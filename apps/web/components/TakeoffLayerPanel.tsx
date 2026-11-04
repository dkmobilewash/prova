"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * ── THE LAYERS, ONE ROW EACH ──
 *
 * The full-screen workspace's right-hand panel: everything drawn on the sheet,
 * as rows an estimator can switch off, pick out and rename. A row is a group
 * the finder returned (named by its type or tag and thickness), the rooms, the
 * doors and windows — the groups that exist today. There is no exterior /
 * interior / corridor classification behind them, and a row never claims one.
 *
 * ── A NAME HERE IS ONE PERSON'S LABEL ──
 *
 * Double-click renames the ROW, in this browser, for this job. It does not
 * touch the wall type in the library (every job using it would change) or the
 * estimate. That is a per-viewer convenience, which is what CLAUDE.md allows
 * `localStorage` for; a name the whole company sees would be a model.
 */

export type Layer = {
  /** Stable across re-finds, so a name and a hidden eye survive one. */
  key: string;
  name: string;
  kind: "line" | "area" | "count";
  colour: string;
  /** The swatch draws the overlay's own dash, so a mark is never only a colour. */
  dash?: string;
  count: number;
  total: string;
  hidden: boolean;
};

type Filter = "all" | Layer["kind"];
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "area", label: "Area" },
  { id: "line", label: "Line" },
  { id: "count", label: "Count" },
];

const namesKey = (jobId: string) => `prova.takeoff.layerNames.${jobId}`;

function readNames(jobId: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(namesKey(jobId));
    return raw === null ? {} : (JSON.parse(raw) as Record<string, string>);
  } catch {
    return {};
  }
}

export function TakeoffLayerPanel({
  jobId,
  layers,
  lit,
  onLit,
  onToggle,
  review,
  children,
}: {
  jobId: string;
  layers: readonly Layer[];
  lit: string | null;
  onLit: (key: string | null) => void;
  onToggle: (key: string) => void;
  /** The "Needs review" row, rendered by the viewer because it owns the action. */
  review?: React.ReactNode;
  /** Everything else the viewer keeps beside the drawing, under the rows. */
  children?: React.ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  // After mount, not in the initialiser: this panel is server-rendered with the
  // page, and a name only this browser knows would be a hydration mismatch.
  useEffect(() => setNames(readNames(jobId)), [jobId]);

  function rename(key: string, name: string) {
    const next = { ...names };
    if (name.trim() === "") delete next[key];
    else next[key] = name.trim();
    setNames(next);
    try {
      window.localStorage.setItem(namesKey(jobId), JSON.stringify(next));
    } catch {
      // Private window or blocked storage: the name lasts until reload.
    }
  }

  const needle = search.trim().toLowerCase();
  const shown = layers.filter(
    (layer) =>
      (filter === "all" || layer.kind === filter) &&
      (needle === "" || (names[layer.key] ?? layer.name).toLowerCase().includes(needle)),
  );

  return (
    <div className="flex flex-col gap-2 p-2" data-takeoff="layer-panel">
      <div className="grid grid-cols-4 gap-1" role="group" aria-label="Show layers of one kind">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setFilter(entry.id)}
            aria-pressed={filter === entry.id}
            // Named for what it shows: a bare "Line" or "Count" is also a tool's
            // name, and a click by name must reach one control, not two.
            aria-label={`${entry.label} layers`}
            data-takeoff={`layer-filter-${entry.id}`}
            className={`rounded-md px-1 py-1 text-xs ${
              filter === entry.id ? "bg-ink text-canvas" : "text-ink-body hover:bg-rail-hover"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search layers"
        aria-label="Search layers"
        data-takeoff="layer-search"
        className="w-full rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink-body"
      />
      {/* The wall legend this job prices against: its own page, in a tab of its
          own, so leaving this one does not lose the drawing. */}
      <Link
        href={`/jobs/${jobId}/takeoff/legend`}
        target="_blank"
        rel="noopener"
        data-takeoff="layer-legend"
        className="flex items-center gap-2 rounded-md bg-rail px-2 py-1.5 text-xs font-medium text-ink-label hover:bg-rail-hover"
      >
        <span aria-hidden>☰</span> Legend
      </Link>
      {review}
      <ul className="flex flex-col" data-takeoff="layer-rows">
        {shown.length === 0 && (
          <li className="px-2 py-1.5 text-xs text-ink-muted" data-takeoff="layers-empty">
            {layers.length === 0 ? "Nothing on this sheet yet. Run takeoff, or measure by hand." : "No layer matches."}
          </li>
        )}
        {shown.map((layer) => (
          <li
            key={layer.key}
            data-takeoff="layer-row"
            data-layer={layer.key}
            data-lit={lit === layer.key ? "true" : undefined}
            onClick={() => onLit(lit === layer.key ? null : layer.key)}
            onDoubleClick={() => setRenaming(layer.key)}
            className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-xs ${
              lit === layer.key ? "bg-rail-hover" : "hover:bg-rail"
            } ${layer.hidden ? "opacity-50" : ""}`}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(layer.key);
              }}
              aria-pressed={!layer.hidden}
              aria-label={`${layer.hidden ? "Show" : "Hide"} ${names[layer.key] ?? layer.name}`}
              data-takeoff="layer-eye"
              className="w-4 shrink-0 text-ink-muted hover:text-ink-body"
            >
              {layer.hidden ? "○" : "◉"}
            </button>
            <svg aria-hidden width="16" height="8" viewBox="0 0 16 8" className="shrink-0">
              <line x1="0" y1="4" x2="16" y2="4" stroke={layer.colour} strokeWidth="3" strokeDasharray={layer.dash} />
            </svg>
            {renaming === layer.key ? (
              <input
                autoFocus
                name="layerName"
                defaultValue={names[layer.key] ?? layer.name}
                aria-label="Layer name"
                data-takeoff="layer-rename"
                onClick={(event) => event.stopPropagation()}
                onBlur={(event) => {
                  rename(layer.key, event.target.value);
                  setRenaming(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                  if (event.key === "Escape") setRenaming(null);
                  event.stopPropagation();
                }}
                className="min-w-0 flex-1 rounded border border-line-card bg-surface px-1 text-xs text-ink"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-ink" title={layer.name} data-takeoff="layer-name">
                {names[layer.key] ?? layer.name}
              </span>
            )}
            <span className="shrink-0 rounded bg-rail px-1 text-[10px] text-ink-muted">{layer.count}</span>
            <span className="w-20 shrink-0 text-right tabular-nums text-ink-body" data-takeoff="layer-total">
              {layer.total}
            </span>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}
