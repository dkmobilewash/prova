import type { StrokeSegment, WallCandidate } from "./wallVectors";
import { doorSymbols, tagsNameEveryWindow, windowSymbols, type DoorSymbol, type WindowSymbol } from "./doorWindowSymbols";
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
  /**
   * Schedule rows no door on this sheet carries, by mark — the rows a
   * reviewer reconciles by hand: a door on another sheet of the set, or one
   * drawn with no swing and no readable tag. Empty when there is no schedule.
   */
  unplacedMarks: string[];
};

/** The doors on the sheet: those drawn, plus those the schedule placed from a mark with no swing. */
export function doorCount(result: DoorsWindowsResult): number {
  return result.doors.length + (result.join?.placedByMark ?? 0);
}

/** A window tag is a short code in a symbol: W1, W2, A, 1. A door mark (101) is not one. */
const WINDOW_TAG = /^W?\d{1,2}[A-Z]?$|^[A-Z]$/;

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
  const symbols = tagSymbols({ segments: input.segmentsPt, text: input.textPt, unitsPerPaperInch: 72 });
  const W = input.widthPt;
  const windowTags = symbols.filter((s) => s.rejected === null && WINDOW_TAG.test(s.text.trim().toUpperCase())).map((s) => ({ x: s.x / W, y: s.y / W }));
  const tagWords = symbols.filter((s) => s.rejected === null).map((s) => s.text);
  const windows = windowSymbols(input.segments, input.walls, input.feetPerUnit, windowTags, tagsNameEveryWindow(tagWords));
  const rows = scheduledOpenings(input.scheduleRows);
  if (rows.length === 0) return { doors, windows, join: null, unplacedMarks: [] };
  const scheduled = new Set(rows.map((r) => r.mark.toUpperCase()));
  const marks: PlacedMark[] = symbols
    .filter((s) => s.rejected === null || (s.rejected === "sheet-reference" && scheduled.has(s.text.trim().toUpperCase())))
    .map((s) => ({ text: s.text, x: s.x / W, y: s.y / W, inSymbol: true }));
  // ── A MARK PRINTED LOOSE, OR IN A PILL THE SYMBOL PASS DOES NOT DRAW ──
  // Bunkie prints its door marks in rounded pills, which `tagSymbols` does
  // not see; E101 and E102 went unnamed for it. A text item that IS a
  // schedule mark, and sits in no symbol already read, is a mark too — the
  // schedule is the vocabulary, so a room number that happens to match a
  // row is the same risk the symbol marks already carry, and the join's
  // nearest-a-wall rule is what sorts the two.
  for (const item of input.textPt) {
    const text = item.str.trim();
    if (!scheduled.has(text.toUpperCase())) continue;
    const x = (item.x + item.width / 2) / W, y = (item.y - item.height / 2) / W;
    if (symbols.some((s) => Math.hypot(s.x / W - x, s.y / W - y) <= (s.radius / W) * 1.2)) continue;
    marks.push({ text, x, y, inSymbol: false });
  }
  const join = joinOpeningsToSchedule({
    openings: doors.map((d) => ({ x1: d.hinge.x, y1: d.hinge.y, x2: d.strike.x, y2: d.strike.y, widthFeet: d.widthFeet })),
    marks,
    rows,
    feetPerUnit: input.feetPerUnit,
    walls: input.walls,
  });
  const carried = new Set(join.openings.map((o) => (o.mark ?? "").trim().toUpperCase()));
  const unplacedMarks = [...new Set(rows.map((r) => r.mark.toUpperCase()))].filter((m) => !carried.has(m)).map((m) => rows.find((r) => r.mark.toUpperCase() === m)!.mark);
  return { doors, windows, join, unplacedMarks };
}
