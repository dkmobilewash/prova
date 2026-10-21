"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRoomMeasurements, type RoomToSave } from "@/lib/actions";
import type { RoomsFromWallsResult } from "@/lib/takeoff/roomsFromWalls";

/**
 * ── THE ROOMS PANEL ──
 *
 * One row per room the flood fill closed: the tag's name and number (editable
 * — the reader can be wrong, or the tag missing), square feet, perimeter, and
 * a status. Below the rows, the tags that landed in NO closed room and the
 * ones that SHARED a room with another, because a detector is judged by what
 * it misses and an estimator has to know which rooms to draw by hand.
 *
 * Hovering a row lights its polygon on the drawing; the viewer does the
 * lighting, this only says which. Saving writes every listed room as an AREA
 * measurement in one transaction (`saveRoomMeasurements`), after which the
 * areas are ordinary measurements: drag a corner, add a cutout, delete.
 *
 * Perimeter is computed here from the polygon and never stored.
 */
export function TakeoffRoomsPanel({
  jobId,
  pageId,
  result,
  feetPerUnit,
  hovered,
  onHover,
  onClear,
}: {
  jobId: string;
  pageId: string;
  result: RoomsFromWallsResult;
  feetPerUnit: number;
  hovered: number | null;
  onHover: (id: number | null) => void;
  onClear: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<number, { name: string; number: string }>>({});
  const [saved, setSaved] = useState(false);

  const nameOf = (id: number, fallback: { name: string; number: string | null } | null) =>
    names[id] ?? { name: fallback?.name ?? "", number: fallback?.number ?? "" };
  const totalSf = result.rooms.reduce((n, r) => n + r.squareFeet, 0);
  const totalLf = result.rooms.reduce((n, r) => n + r.perimeterFeet, 0);

  function onSave() {
    setError(null);
    const rooms: RoomToSave[] = result.rooms.map((room) => {
      const edited = nameOf(room.id, room.tag);
      const label = [edited.name, edited.number].filter(Boolean).join(" ").trim();
      return {
        xs: room.xs,
        ys: room.ys,
        label: label || `Room ${room.id + 1}`,
        roomName: edited.name || null,
        roomNumber: edited.number || null,
      };
    });
    const formData = new FormData();
    formData.set("pageId", pageId);
    formData.set("rooms", JSON.stringify(rooms));
    startTransition(async () => {
      const outcome = await saveRoomMeasurements(jobId, formData);
      if (!outcome.ok) return setError(outcome.error);
      setSaved(true);
      router.refresh();
      onClear();
    });
  }

  void feetPerUnit;
  return (
    <div className="mt-3 border-t border-line-card pt-3" data-takeoff="rooms-panel">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {result.rooms.length} {result.rooms.length === 1 ? "room" : "rooms"}
        </h3>
        <span className="text-xs text-ink-muted">
          {Math.round(totalSf).toLocaleString()} sf · {Math.round(totalLf).toLocaleString()} ft of perimeter
        </span>
      </div>
      {result.rooms.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted" data-takeoff="rooms-none">
          No closed room. Every wall found on this sheet leaks somewhere — draw the missing walls with the Line tool and
          find the rooms again.
        </p>
      ) : (
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left text-ink-label">
              <th className="py-1 pr-2 font-medium">Room</th>
              <th className="py-1 pr-2 font-medium">No.</th>
              <th className="py-1 pr-2 text-right font-medium">sq ft</th>
              <th className="py-1 text-right font-medium">perim. ft</th>
            </tr>
          </thead>
          <tbody>
            {result.rooms.map((room) => {
              const edited = nameOf(room.id, room.tag);
              return (
                <tr
                  key={room.id}
                  data-takeoff="room-row"
                  data-room-named={room.tag ? "1" : "0"}
                  onMouseEnter={() => onHover(room.id)}
                  onMouseLeave={() => onHover(null)}
                  className={hovered === room.id ? "bg-rail-hover" : undefined}
                >
                  <td className="py-1 pr-2">
                    <input
                      aria-label="Room name"
                      value={edited.name}
                      placeholder="unnamed"
                      onChange={(e) => setNames((prev) => ({ ...prev, [room.id]: { ...edited, name: e.target.value } }))}
                      className="w-36 rounded border border-line-card bg-surface-input px-1 py-0.5 text-xs text-ink-body"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      aria-label="Room number"
                      value={edited.number}
                      placeholder="—"
                      onChange={(e) => setNames((prev) => ({ ...prev, [room.id]: { ...edited, number: e.target.value } }))}
                      className="w-16 rounded border border-line-card bg-surface-input px-1 py-0.5 text-xs text-ink-body"
                    />
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-ink-body" data-takeoff="room-sf">
                    {Math.round(room.squareFeet).toLocaleString()}
                  </td>
                  <td className="py-1 text-right tabular-nums text-ink-body">{Math.round(room.perimeterFeet).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {(result.unplacedTags.length > 0 || result.mergedTags.length > 0) && (
        <p className="mt-2 text-xs text-ink-muted" data-takeoff="rooms-missed">
          {result.unplacedTags.length > 0 && (
            <>
              <span className="font-medium text-ink-label">Not enclosed:</span>{" "}
              {result.unplacedTags.map((t) => [t.name, t.number].filter(Boolean).join(" ")).join(", ")} — a wall is
              missing; draw it with the Line tool and find the rooms again.{" "}
            </>
          )}
          {result.mergedTags.length > 0 && (
            <>
              <span className="font-medium text-ink-label">Share one room:</span>{" "}
              {result.mergedTags.map((t) => [t.name, t.number].filter(Boolean).join(" ")).join(", ")} — open to each
              other on the drawing.
            </>
          )}
        </p>
      )}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={isPending || result.rooms.length === 0}
          data-takeoff="save-rooms"
          className="min-h-[36px] rounded-md bg-rail-hover px-3 text-xs font-medium text-ink hover:bg-lift disabled:opacity-50"
        >
          {isPending ? "Saving…" : `Save ${result.rooms.length === 1 ? "this room" : "these rooms"} as areas`}
        </button>
        <button type="button" onClick={onClear} className="text-xs text-ink-muted underline hover:text-ink-body">
          Clear
        </button>
        {saved && <span className="text-xs text-ink-muted">Saved.</span>}
        {error && (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
