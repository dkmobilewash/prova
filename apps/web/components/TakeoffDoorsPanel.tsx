"use client";

import type { DoorsWindowsResult } from "@/lib/takeoff/doorsWindows";

/**
 * What the drawing's own symbols say about its doors and windows, after
 * Find the walls. Doors are counted and measured from their swing (the leaf's
 * radius IS the width), placed on a found run, and named from the door
 * schedule where a mark sits beside them. Windows are offered to check: the
 * symbol is three parallel lines across an exterior wall, and so is some
 * casework. No model. See `lib/takeoff/NOTES-doors.md`.
 */
export function TakeoffDoorsPanel({
  result,
  groupOfWall,
  hovered,
  onHover,
}: {
  result: DoorsWindowsResult;
  /** The 1-based group number a wall index belongs to, for "on group 3". */
  groupOfWall: (wall: number) => number | null;
  hovered: string | null;
  onHover: (id: string | null) => void;
}) {
  const { doors, windows, join } = result;
  const pairs = doors.filter((d) => d.leaves === 2).length;
  const placed = doors.filter((d) => d.wall !== null).length;
  const joined = join?.openings ?? null;
  return (
    <div data-takeoff="doors-windows" className="mt-3 rounded-lg border border-line-card bg-surface p-3 text-xs">
      <p className="text-sm font-medium text-ink">
        {doors.length} {doors.length === 1 ? "door" : "doors"}
        {pairs > 0 ? ` (${pairs} ${pairs === 1 ? "pair" : "pairs"})` : ""}, {windows.length}{" "}
        {windows.length === 1 ? "window" : "windows"} to check
      </p>
      <p className="mt-0.5 text-ink-muted">
        Read from the swings and sills drawn on this sheet. {placed} of {doors.length} on a found run.
        {join !== null
          ? ` Schedule: ${join.matched} named by a mark beside the door, ${join.rowsTotal} rows in the schedule${
              join.placedByMark > 0 ? `, ${join.placedByMark} placed from a mark with no swing drawn` : ""
            }.`
          : " No door schedule has been read for this set, so doors carry the width drawn."}
      </p>
      {doors.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-y-auto">
          {doors.map((d, i) => {
            const j = joined?.find((o) => o.opening.x1 === d.hinge.x && o.opening.y1 === d.hinge.y) ?? null;
            const group = d.wall === null ? null : groupOfWall(d.wall);
            const id = `door-${i}`;
            return (
              <li
                key={id}
                data-door={i}
                onMouseEnter={() => onHover(id)}
                onMouseLeave={() => onHover(null)}
                className={`flex items-baseline gap-2 rounded px-1 py-0.5 ${hovered === id ? "bg-rail-hover" : ""}`}
              >
                <span className="w-16 shrink-0 font-medium text-ink">{j?.mark ?? `Door ${i + 1}`}</span>
                <span className="text-ink-body">
                  {(j?.widthFt ?? d.widthFeet).toFixed(1)} ft{d.leaves === 2 ? " pair" : ""}
                  {j !== null && j.widthFrom === "schedule" ? " (schedule)" : ""}
                  {j?.mismatch ? ` — drawn ${j.mismatch.drawnFeet.toFixed(1)}` : ""}
                </span>
                <span className="ml-auto text-ink-muted">{group === null ? "not on a found run" : `group ${group}`}</span>
              </li>
            );
          })}
        </ul>
      )}
      {windows.length > 0 && (
        <ul className="mt-2 max-h-32 overflow-y-auto border-t border-line-card pt-2">
          {windows.map((w, i) => {
            const id = `window-${i}`;
            return (
              <li
                key={id}
                data-window={i}
                onMouseEnter={() => onHover(id)}
                onMouseLeave={() => onHover(null)}
                className={`flex items-baseline gap-2 rounded px-1 py-0.5 ${hovered === id ? "bg-rail-hover" : ""}`}
              >
                <span className="w-16 shrink-0 font-medium text-ink">Window {i + 1}</span>
                <span className="text-ink-body">{w.widthFeet.toFixed(1)} ft, {w.lines} lines</span>
                <span className="ml-auto text-ink-muted">group {groupOfWall(w.wall) ?? "?"}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
