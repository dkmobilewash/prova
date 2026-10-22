"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRoomMeasurements, type RoomToSave } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";
import type { RoomsFromWallsResult } from "@/lib/takeoff/roomsFromWalls";
import { ceilingSummary, type RoomCeiling } from "@/lib/takeoff/roomCeilings";

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
const FAMILY_WORD: Record<string, string> = { ACT: "acoustical tile", GYP: "gypsum board", OPEN: "open to structure", OTHER: "other" };
const SOURCE_WORD: Record<string, string> = {
  tag: "ceiling plan tag",
  schedule: "finish schedule",
  pattern: "drawn pattern",
  note: "sheet note",
  prefix: "guess from the code",
  estimator: "typed by you",
};

export function TakeoffRoomsPanel({
  jobId,
  pageId,
  result,
  ceilings = null,
  savedRooms = [],
  feetPerUnit,
  hovered,
  onHover,
  onClear,
}: {
  jobId: string;
  pageId: string;
  result: RoomsFromWallsResult;
  /** What the drawings say about each room's ceiling (by room id); null while being read. */
  ceilings?: Map<number, RoomCeiling> | null;
  /** Every room already saved on the job with a ceiling, for the job summary. */
  savedRooms?: { pageNumber: number; squareFeet: number; family: string | null; code: string | null }[];
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
  /** The estimator's edits to a ceiling, over what was read. */
  const [edits, setEdits] = useState<Record<number, { family?: string; heightFeet?: string }>>({});
  /** The ceiling a row shows: what was read, overlaid with what the estimator typed. */
  const ceilingOf = (id: number): { family: string | null; code: string | null; heightFeet: number | null; from: string | null; guess: boolean } => {
    const read = ceilings?.get(id) ?? null;
    const e = edits[id] ?? {};
    const family = e.family !== undefined ? (e.family === "" ? null : e.family) : (read?.family ?? null);
    const heightFeet = e.heightFeet !== undefined ? (e.heightFeet.trim() === "" ? null : Number(e.heightFeet)) : (read?.heightFeet ?? null);
    const edited = e.family !== undefined || e.heightFeet !== undefined;
    return { family, code: edited ? null : (read?.code ?? null), heightFeet: Number.isFinite(heightFeet) ? heightFeet : null, from: edited ? "estimator" : (read?.from ?? null), guess: edited ? false : (read?.guess ?? false) };
  };
  const sheetSummary = ceilingSummary(result.rooms.map((r) => ({ family: ceilingOf(r.id).family, squareFeet: r.squareFeet, code: ceilingOf(r.id).code })));
  const jobSummary = ceilingSummary(savedRooms.map((r) => ({ family: r.family, squareFeet: r.squareFeet, code: r.code })));

  const nameOf = (id: number, fallback: { name: string; number: string | null } | null) =>
    names[id] ?? { name: fallback?.name ?? "", number: fallback?.number ?? "" };
  const totalSf = result.rooms.reduce((n, r) => n + r.squareFeet, 0);
  const totalLf = result.rooms.reduce((n, r) => n + r.perimeterFeet, 0);

  function onSave() {
    setError(null);
    const rooms: RoomToSave[] = result.rooms.map((room) => {
      const edited = nameOf(room.id, room.tag);
      const label = [edited.name, edited.number].filter(Boolean).join(" ").trim();
      const c = ceilingOf(room.id);
      return {
        xs: room.xs,
        ys: room.ys,
        label: label || `Room ${room.id + 1}`,
        roomName: edited.name || null,
        roomNumber: edited.number || null,
        ceiling: c.family === null && c.heightFeet === null ? null : { family: c.family, code: c.code, heightFeet: c.heightFeet, from: c.from, guess: c.guess },
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
          {/* One <tbody> per room: the room's line, then its ceiling on a second
              line, because the panel is too narrow for seven columns and a
              ceiling that scrolls sideways is a ceiling nobody checks. */}
          {result.rooms.map((room) => {
              const edited = nameOf(room.id, room.tag);
              return (
                <tbody
                  key={room.id}
                  data-takeoff="room-row"
                  data-room-named={room.tag ? "1" : "0"}
                  onMouseEnter={() => onHover(room.id)}
                  onMouseLeave={() => onHover(null)}
                  className={hovered === room.id ? "bg-rail-hover" : undefined}
                >
                <tr>
                  <td className="py-1 pr-2">
                    <input
                      name="roomName"
                      aria-label="Room name"
                      value={edited.name}
                      placeholder="unnamed"
                      onChange={(e) => setNames((prev) => ({ ...prev, [room.id]: { ...edited, name: e.target.value } }))}
                      className="w-36 rounded border border-line-card bg-surface px-1 py-0.5 text-xs text-ink-body"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      name="roomNumber"
                      aria-label="Room number"
                      value={edited.number}
                      placeholder="—"
                      onChange={(e) => setNames((prev) => ({ ...prev, [room.id]: { ...edited, number: e.target.value } }))}
                      className="w-16 rounded border border-line-card bg-surface px-1 py-0.5 text-xs text-ink-body"
                    />
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-ink-body" data-takeoff="room-sf">
                    {Math.round(room.squareFeet).toLocaleString()}
                  </td>
                  <td className="py-1 text-right tabular-nums text-ink-body">{Math.round(room.perimeterFeet).toLocaleString()}</td>
                </tr>
                  {/* ── THE CEILING, EDITABLE, WITH WHERE IT CAME FROM ──
                      What the drawings said is shown as read; a change by the
                      estimator replaces the source with "typed by you" and drops
                      the guess flag, since a person has now decided. */}
                  {(() => {
                    const c = ceilingOf(room.id);
                    return (
                      <tr>
                        <td colSpan={4} className="pb-2 pl-2 pt-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                          <span>ceiling</span>
                          <select
                            aria-label="Ceiling type"
                            value={c.family ?? ""}
                            data-takeoff="room-ceiling"
                            data-ceiling-from={c.from ?? ""}
                            onChange={(e) => setEdits((prev) => ({ ...prev, [room.id]: { ...prev[room.id], family: e.target.value } }))}
                            className="rounded border border-line-card bg-surface px-1 py-0.5 text-xs text-ink-body"
                          >
                            <option value="">—</option>
                            <option value="ACT">acoustical tile{c.code && c.family === "ACT" ? ` (${c.code})` : ""}</option>
                            <option value="GYP">gypsum board{c.code && c.family === "GYP" ? ` (${c.code})` : ""}</option>
                            <option value="OPEN">open to structure</option>
                            <option value="OTHER">other</option>
                          </select>
                          <input
                            aria-label="Ceiling height in feet"
                            inputMode="decimal"
                            value={edits[room.id]?.heightFeet ?? (c.heightFeet === null ? "" : String(+c.heightFeet.toFixed(2)))}
                            placeholder="—"
                            data-takeoff="room-ceiling-height"
                            onChange={(e) => setEdits((prev) => ({ ...prev, [room.id]: { ...prev[room.id], heightFeet: e.target.value } }))}
                            className="w-14 rounded border border-line-card bg-surface px-1 py-0.5 text-right text-xs tabular-nums text-ink-body"
                          />
                          <span>ft</span>
                          <span data-takeoff="room-ceiling-from" title={ceilings?.get(room.id)?.phrase ?? undefined}>
                          {ceilings === null && c.from === null ? (
                            <span className="inline-flex items-center gap-1">
                              <Spinner /> reading…
                            </span>
                          ) : c.from === null ? (
                            "nothing read"
                          ) : (
                            <>
                              {SOURCE_WORD[c.from] ?? c.from}
                              {ceilings?.get(room.id)?.page && c.from !== "estimator" ? ` p${ceilings.get(room.id)!.page}` : ""}
                              {c.guess && (
                                <span className="ml-1 rounded bg-tag-amber px-1 text-tag-amber-ink" data-takeoff="ceiling-guess">
                                  guess
                                </span>
                              )}
                            </>
                          )}
                          </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              );
            })}
        </table>
      )}
      {/* ── CEILINGS BY TYPE: THIS SHEET, THEN THE WHOLE JOB ──
          The line an estimate needs — square feet per ceiling type — for the
          rooms on screen as they stand (edits included), and for every room
          already saved on the job. */}
      {result.rooms.length > 0 && (
        <p className="mt-2 text-xs text-ink-body" data-takeoff="ceiling-summary-sheet">
          <span className="font-medium text-ink-label">Ceilings on this sheet:</span>{" "}
          {sheetSummary.map((s) => `${s.label}: ${Math.round(s.squareFeet).toLocaleString()} sf`).join(" · ")}
        </p>
      )}
      {jobSummary.length > 0 && (
        <p className="mt-1 text-xs text-ink-muted" data-takeoff="ceiling-summary-job">
          <span className="font-medium text-ink-label">Saved on this job:</span>{" "}
          {jobSummary.map((s) => `${s.label}: ${Math.round(s.squareFeet).toLocaleString()} sf`).join(" · ")}
        </p>
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
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Saving…
            </span>
          ) : (
            `Save ${result.rooms.length === 1 ? "this room" : "these rooms"} as areas`
          )}
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
