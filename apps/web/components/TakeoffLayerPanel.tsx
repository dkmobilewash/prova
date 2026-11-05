"use client";

import Link from "next/link";
import { useState } from "react";
import { LAYER_NAME_MAX } from "@/lib/takeoff/layerKey";

/**
 * ── THE LAYERS, ONE ROW EACH ──
 *
 * The full-screen workspace's right-hand panel: everything drawn on the sheet,
 * as rows an estimator can switch off, pick out and rename. A row is a group
 * the finder returned (named by its type or tag and thickness), the rooms, the
 * doors and windows — the groups that exist today. There is no exterior /
 * interior / corridor classification behind them, and a row never claims one.
 *
 * ── A NAME HERE IS THE TEAM'S ──
 *
 * Double-click renames the row for everybody on this job: it is saved as a
 * `TakeoffLayerName` and shows in this panel, the group's Quantities detail
 * and the export's "Wall groups" tab. It does not touch the wall type in the
 * library (every job using it would change) or the estimate. An empty name
 * goes back to the default.
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

export function TakeoffLayerPanel({
  jobId,
  layers,
  names,
  onRename,
  lit,
  onLit,
  onToggle,
  banner,
  review,
  children,
}: {
  jobId: string;
  layers: readonly Layer[];
  /** The team's saved names, by layer key, as the server last rendered them. */
  names: Readonly<Record<string, string>>;
  /** Saves a name for the team; resolves to a sentence when it did not save. */
  onRename: (key: string, name: string) => Promise<string | null>;
  lit: string | null;
  onLit: (key: string | null) => void;
  onToggle: (key: string) => void;
  /** A folded caution about the sheet, over everything else. */
  banner?: React.ReactNode;
  /** The "Needs review" row, rendered by the viewer because it owns the action.
   *  Walls, so it shows under All and Line. */
  review?: React.ReactNode;
  /** Everything else the viewer keeps beside the drawing, under the rows. */
  children?: React.ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  // What was just typed, shown at once while the save goes; the server's
  // `names` take over when the page re-renders with them. `null` = cleared.
  const [typed, setTyped] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const nameOf = (layer: Layer) => {
    const mine = typed[layer.key];
    return mine === null ? layer.name : (mine ?? names[layer.key] ?? layer.name);
  };

  async function rename(layer: Layer, raw: string) {
    const name = raw.trim();
    if (name === nameOf(layer)) return;
    // Typing the default back is clearing it: the row then follows the group.
    const value = name === layer.name ? "" : name;
    setTyped((was) => ({ ...was, [layer.key]: value === "" ? null : value }));
    setError(null);
    const problem = await onRename(layer.key, value);
    if (problem !== null) {
      setError(problem);
      setTyped((was) => {
        const next = { ...was };
        delete next[layer.key];
        return next;
      });
    }
  }

  const needle = search.trim().toLowerCase();
  const shown = layers.filter(
    (layer) =>
      (filter === "all" || layer.kind === filter) &&
      (needle === "" || nameOf(layer).toLowerCase().includes(needle)),
  );

  return (
    <div className="flex min-w-0 flex-col gap-2 p-2" data-takeoff="layer-panel">
      {banner}
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
      {error !== null && (
        <p role="alert" className="text-xs text-tag-rose-ink" data-takeoff="layer-rename-error">
          {error}
        </p>
      )}
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
              aria-label={`${layer.hidden ? "Show" : "Hide"} ${nameOf(layer)}`}
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
                maxLength={LAYER_NAME_MAX}
                placeholder={layer.name}
                defaultValue={nameOf(layer)}
                aria-label="Layer name"
                data-takeoff="layer-rename"
                onClick={(event) => event.stopPropagation()}
                onBlur={(event) => {
                  void rename(layer, event.target.value);
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
              <span
                className="min-w-0 flex-1 truncate text-ink"
                title={nameOf(layer) === layer.name ? layer.name : `${nameOf(layer)} (${layer.name})`}
                data-takeoff="layer-name"
              >
                {nameOf(layer)}
              </span>
            )}
            <span className="shrink-0 rounded bg-rail px-1 text-[10px] text-ink-muted">{layer.count}</span>
            <span className="w-20 shrink-0 text-right tabular-nums text-ink-body" data-takeoff="layer-total">
              {layer.total}
            </span>
          </li>
        ))}
        {/* Hidden rather than unmounted under Area and Count: it is a place
            the viewer portals into, and an unmounted place drops its content
            back into the page. */}
        <li className={filter === "area" || filter === "count" ? "hidden" : undefined}>{review}</li>
      </ul>
      {children}
    </div>
  );
}
