import type { StrokeSegment, WallCandidate } from "./wallVectors";
import { doorSymbols, windowSymbols, type DoorSymbol, type WindowSymbol } from "./doorWindowSymbols";
import { joinOpeningsToSchedule, widthAndHeight, type OpeningJoin, type PlacedMark, type ScheduledOpening } from "./openingMarks";
import { tagSymbols, type TextForSymbol } from "./tagSymbols";

/**
 * ── ONE SHEET'S DOORS AND WINDOWS, FROM ITS SYMBOLS, JOINED TO ITS SCHEDULE ──
 *
 * The viewer calls this after Find the walls, with what it already holds:
 * the strokes in page-width units for the symbols, the strokes and text in
 * page POINTS for the mark symbols (`tagSymbols` measures them in paper
 * inches), the found walls, and the door schedule rows the ingest read, if
 * any. Pure, so the eval and the tests call the same function.
 *
 * The join is the second session's `joinOpeningsToSchedule`: a mark drawn
 * in a symbol beside a door is the schedule's row, and the row's width is
 * the better witness when it disagrees with the drawn leaf. Here the drawn
 * width is the leaf's own radius rather than a wall gap, so the two agree
 * to the inch on every door measured — the join's job becomes naming the
 * door, and catching the schedule row with no door drawn.
 */
export type DoorsWindowsResult = {
  doors: DoorSymbol[];
  windows: WindowSymbol[];
  /** Null when the set has no door schedule rows to join to. */
  join: OpeningJoin | null;
};

/** A door schedule row as the ingest stores it (`PlanScheduleProposal.rows`). */
export type StoredScheduleRow = { mark: string; size?: string | null; description?: string | null };

export function scheduledOpenings(rows: readonly StoredScheduleRow[]): ScheduledOpening[] {
  return rows
    .filter((r) => typeof r.mark === "string" && r.mark.trim() !== "")
    .map((r) => {
      const { widthFt, heightFt } = widthAndHeight(r.size ?? null);
      return { mark: r.mark.trim(), widthFt, heightFt, description: r.description ?? null };
    });
}

export function doorsAndWindowsForSheet(input: {
  /** Strokes in page-width units (the finder's `inUnits`). */
  segments: readonly StrokeSegment[];
  /** The same strokes in page points, for the mark symbols. */
  segmentsPt: readonly StrokeSegment[];
  textPt: readonly TextForSymbol[];
  widthPt: number;
  walls: readonly WallCandidate[];
  feetPerUnit: number;
  scheduleRows: readonly StoredScheduleRow[];
}): DoorsWindowsResult {
  const doors = doorSymbols(input.segments, input.walls, input.feetPerUnit);
  const windows = windowSymbols(input.segments, input.walls, input.feetPerUnit);
  const rows = scheduledOpenings(input.scheduleRows);
  if (rows.length === 0) return { doors, windows, join: null };
  const scheduled = new Set(rows.map((r) => r.mark.toUpperCase()));
  const marks: PlacedMark[] = tagSymbols({ segments: input.segmentsPt, text: input.textPt, unitsPerPaperInch: 72 })
    .filter((s) => s.rejected === null || (s.rejected === "sheet-reference" && scheduled.has(s.text.trim().toUpperCase())))
    .map((s) => ({ text: s.text, x: s.x / input.widthPt, y: s.y / input.widthPt, inSymbol: true }));
  const join = joinOpeningsToSchedule({
    openings: doors.map((d) => ({ x1: d.hinge.x, y1: d.hinge.y, x2: d.strike.x, y2: d.strike.y, widthFeet: d.widthFeet })),
    marks,
    rows,
    feetPerUnit: input.feetPerUnit,
    walls: input.walls,
  });
  return { doors, windows, join };
}
