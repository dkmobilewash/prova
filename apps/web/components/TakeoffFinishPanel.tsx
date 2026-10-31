"use client";

import { useMemo, useState, useTransition } from "react";
import { addFinishLinesToEstimate } from "@/lib/actions";
import { Spinner } from "@/components/Spinner";
import type { DoorSymbol, WindowSymbol } from "@/lib/takeoff/doorWindowSymbols";
import type { FinishSchedule, TextItem } from "@/lib/takeoff/finishSchedule";
import { DOOR_HEIGHT_FEET, finishLineLabel, finishTakeoff, typesFromNeighbours, typeTagsInRooms, WINDOW_HEIGHT_FEET } from "@/lib/takeoff/finishTakeoff";
import type { RoomCeiling } from "@/lib/takeoff/roomCeilings";
import type { RoomFromWalls } from "@/lib/takeoff/roomsFromWalls";

/** The room finish schedule joined to the found rooms, with what it assumes on screen, and one press to the estimate. */
export function TakeoffFinishPanel({
  jobId,
  sheetName,
  rooms,
  ceilings,
  words,
  widthPt,
  feetPerUnit,
  doors,
  windows,
  onRead,
}: {
  jobId: string;
  sheetName: string;
  rooms: readonly RoomFromWalls[];
  ceilings: Map<number, RoomCeiling> | null;
  words: readonly TextItem[];
  widthPt: number;
  feetPerUnit: number;
  doors: readonly DoorSymbol[];
  windows: readonly WindowSymbol[];
  onRead: () => Promise<FinishSchedule | null>;
}) {
  const [schedule, setSchedule] = useState<FinishSchedule | null | undefined>(undefined);
  const [reading, setReading] = useState(false);
  const [height, setHeight] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const typed = Number(height);
  const fallback = height.trim() !== "" && Number.isFinite(typed) && typed > 0 ? typed : null;
  const result = useMemo(() => {
    if (!schedule) return null;
    const tagged = schedule.byType ? typeTagsInRooms(rooms, words, widthPt, new Set(schedule.rows.map((r) => r.key))) : undefined;
    const inherited = tagged ? typesFromNeighbours(rooms, tagged, feetPerUnit) : new Map<number, string>();
    const typeOfRoom = tagged ? new Map([...tagged, ...inherited]) : undefined;
    return { inherited: inherited.size, ...finishTakeoff({ rooms, schedule, typeOfRoom, doors, windows, feetPerUnit, heightOf: (room) => ceilings?.get(room.id)?.heightFeet ?? fallback }) };
  }, [schedule, rooms, words, widthPt, doors, windows, feetPerUnit, ceilings, fallback]);
  const read = async () => {
    setReading(true);
    setError(null);
    try {
      setSchedule(await onRead());
    } catch {
      setError("The set could not be read for a finish schedule. Try again in a moment.");
    } finally {
      setReading(false);
    }
  };
  if (schedule === undefined) {
    return (
      <div data-takeoff="finish-panel" className="mt-3 border-t border-line-card pt-3 text-xs">
        <button type="button" onClick={read} disabled={reading} data-takeoff="read-finishes" className="min-h-[36px] rounded-md border border-line-card bg-surface px-3 font-medium text-ink-body hover:bg-rail-hover disabled:opacity-50">
          {reading ? <span className="flex items-center gap-2"><Spinner /> Reading the set…</span> : "Read the finish schedule"}
        </button>
        {error && <p className="mt-2 text-danger">{error}</p>}
      </div>
    );
  }
  if (schedule === null || result === null) return <p data-takeoff="finish-panel" className="mt-3 border-t border-line-card pt-3 text-xs text-ink-muted">No room finish schedule was found in this set.</p>;
  const add = () =>
    startTransition(async () => {
      setError(null);
      const out = await addFinishLinesToEstimate(jobId, sheetName, result.lines.map((l) => ({ label: finishLineLabel(l), quantity: l.quantity, unit: l.unit })));
      if (!out.ok) return setError(out.error);
      setAdded(out.value.added);
    });
  const rowsMissing = result.unjoinedRows;
  return (
    <div data-takeoff="finish-panel" className="mt-3 border-t border-line-card pt-3 text-xs">
      <h3 className="text-sm font-semibold text-ink" data-takeoff="finish-joined">{result.joined.length} of {rooms.length} rooms joined to the schedule</h3>
      {rowsMissing.length > 0 && <p className="mt-1 text-tag-amber-ink">{rowsMissing.length} scheduled rooms were not found on this sheet, so their finishes are not counted: {rowsMissing.slice(0, 12).map((r) => r.key).join(", ")}{rowsMissing.length > 12 ? " and more" : ""}.</p>}
      {result.inherited > 0 && <p className="mt-1 text-tag-amber-ink">{result.inherited} rooms have no type tag and took the type of the rooms around them.</p>}
      {result.shared.length > 0 && <p className="mt-1 text-tag-amber-ink">{result.shared.length} areas hold more than one scheduled room, because a wall between them was not found. They count only for finishes those rooms share, and inner walls are missing from their wall and base lengths. Left out where they differ: {result.shared.filter((s) => s.differ.length > 0).length}.</p>}
      {result.unjoinedRooms.length > 0 && <p className="mt-1 text-ink-muted">{result.unjoinedRooms.length} found rooms have no schedule row.</p>}
      <label className="mt-2 flex items-center gap-2 text-ink-label">
        Wall height where the drawings give none (ft)
        <input inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} className="w-16 rounded-md border border-line-card bg-surface px-2 py-1 text-ink-body" />
      </label>
      {result.noHeight.length > 0 && <p className="mt-1 text-tag-amber-ink">{result.noHeight.length} rooms have no height, so their walls are left out.</p>}
      <table className="mt-2 w-full">
        <tbody>
          {result.lines.map((l) => (
            <tr key={`${l.kind}${l.finish}`} data-takeoff="finish-line">
              <td className="py-0.5 pr-2 text-ink-body">{finishLineLabel(l)}</td>
              <td className="py-0.5 pr-2 text-right tabular-nums text-ink">{Math.round(l.quantity).toLocaleString()} {l.unit}</td>
              <td className="py-0.5 text-right text-ink-muted">{l.rooms} {l.rooms === 1 ? "room" : "rooms"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-ink-muted">
        North is taken as up the page. Wall area takes off {DOOR_HEIGHT_FEET} ft doors and {WINDOW_HEIGHT_FEET} ft windows on the wall they sit in: {result.doorsDeducted} door and {result.windowsDeducted} window deductions. {doors.length === 0 && "No doors were read on this sheet, so none are deducted. "}Ceiling lines here are separate from the Ceiling items, so if those are priced, use one or the other. Check these against the schedule.
      </p>
      {error && <p className="mt-2 text-danger">{error}</p>}
      {added !== null ? (
        <p className="mt-2 text-ink-body" data-takeoff="finish-added">Added {added} lines to the estimate.</p>
      ) : (
        <button type="button" onClick={add} disabled={isPending || result.lines.length === 0} data-takeoff="add-finishes" className="mt-2 min-h-[36px] rounded-md bg-brand px-3 font-medium text-neutral-900 disabled:opacity-50">
          Add {result.lines.length} lines to the estimate
        </button>
      )}
    </div>
  );
}
