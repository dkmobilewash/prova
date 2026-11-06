"use client";

import { doorCount, type DoorsWindowsResult } from "@/lib/takeoff/doorsWindows";

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
  const { doors, windows, join, unplacedMarks, tagged } = result;
  // Counted by tag when the sheet's tags could be read as windows; else the frames are offered to check.
  const windowCount = tagged?.counted ? tagged.windows.length : null;
  const pairs = doors.filter((d) => d.leaves === 2).length;
  const placed = doors.filter((d) => d.wall !== null).length;
  const joined = join?.openings ?? null;
  const byMark = joined?.filter((o) => o.placedBy === "mark") ?? [];
  const count = doorCount(result);
  return (
    <div data-takeoff="doors-windows" className="mt-3 rounded-lg border border-line-card bg-surface p-3 text-xs">
      <p className="text-sm font-medium text-ink">
        {count} {count === 1 ? "door" : "doors"}
        {pairs > 0 ? ` (${pairs} ${pairs === 1 ? "pair" : "pairs"})` : ""},{" "}
        {windowCount !== null ? (
          <span data-takeoff="windows-by-tag">
            {windowCount} {windowCount === 1 ? "window" : "windows"} by tag
          </span>
        ) : (
          <>
            {windows.length} {windows.length === 1 ? "window" : "windows"} to check
          </>
        )}
      </p>
      {windowCount !== null && tagged && (
        <p className="mt-0.5 text-ink-body" data-takeoff="windows-by-type">
          {tagged.byTag
            .filter((t) => t.count > 0)
            .map((t) => `${t.tag} ×${t.count}${t.row?.widthFt != null && t.row.heightFt != null ? ` (${t.row.widthFt.toFixed(1)} × ${t.row.heightFt.toFixed(1)} ft)` : ""}`)
            .join(", ") || "none tagged on this sheet"}
          {(() => {
            const loose = tagged.byTag.filter((t) => t.count > 0 && t.row === null && tagged.vocabulary === "schedule").map((t) => t.tag);
            const unframed = tagged.windows.filter((w) => w.frame === null).length;
            return (
              <span className="text-ink-muted">
                {tagged.vocabulary === "schedule" ? ". Named from the window schedule" : ". Read from the W tags drawn; no window schedule has been read for this set"}
                {loose.length > 0 ? `; ${loose.join(", ")} not in the schedule read` : ""}
                {unframed > 0 ? `; ${unframed} with no frame drawn by the tag` : ""}.
              </span>
            );
          })()}
        </p>
      )}
      <p className="mt-0.5 text-ink-muted">
        Read from the swings and sills drawn on this sheet. {placed} of {doors.length} on a found run.
        {join !== null
          ? ` Schedule: ${join.matched} named by a mark beside the door, ${join.rowsTotal} rows in the schedule${
              join.placedByMark > 0 ? `, ${join.placedByMark} placed from a mark with no swing drawn` : ""
            }.`
          : " No door schedule has been read for this set, so doors carry the width drawn."}
        {unplacedMarks.length > 0
          ? ` ${unplacedMarks.length} schedule ${unplacedMarks.length === 1 ? "row is" : "rows are"} not on this sheet: ${unplacedMarks.join(", ")}.`
          : ""}
      </p>
      {(doors.length > 0 || byMark.length > 0) && (
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
          {byMark.map((o, i) => (
            <li key={`mark-${i}`} data-door-by-mark={i} className="flex items-baseline gap-2 rounded px-1 py-0.5">
              <span className="w-16 shrink-0 font-medium text-ink">{o.mark}</span>
              <span className="text-ink-body">{o.widthFt.toFixed(1)} ft (schedule)</span>
              <span className="ml-auto text-ink-muted">placed from its tag, no swing drawn</span>
            </li>
          ))}
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
