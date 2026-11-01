import { roomBoundary } from "./roomBoundary";
import { roomSeals } from "./roomSeals";
import { roomsClosedAtDrawnLines, roomsSplitAtDrawnWalls, type RoomsFromWallsResult } from "./roomsFromWalls";
import type { PositionedText } from "./roomTags";
import type { StrokeSegment } from "./wallVectors";

type Line = { x1: number; y1: number; x2: number; y2: number };

/**
 * A sheet's rooms from what a Find left behind. The one path, so the viewer and
 * the whole-set run cannot disagree about a sheet: the boundary, the doors that
 * seal it, and the sheet's own lines for a region that leaked or a room left open. `segments` and
 * `doorLeaves` are in page-width units, and empty when no Find has read them.
 */
export function sheetRooms(input: {
  pairings: Parameters<typeof roomBoundary>[0]["pairings"];
  runs: Parameters<typeof roomBoundary>[0]["runs"];
  drawn: Parameters<typeof roomBoundary>[0]["drawn"];
  segments: readonly StrokeSegment[];
  doorLeaves: readonly Line[];
  feetPerUnit: number;
  text: readonly PositionedText[];
  widthPt: number;
}): RoomsFromWallsResult {
  const { feetPerUnit, segments } = input;
  const walls = roomBoundary({ pairings: input.pairings, runs: input.runs, drawn: input.drawn });
  const doorSeals = segments.length > 0 ? roomSeals(walls, segments, feetPerUnit) : [];
  const lines = [...segments, ...input.doorLeaves];
  const base = { walls, feetPerUnit, text: input.text, widthPt: input.widthPt, doorSeals };
  return roomsClosedAtDrawnLines(roomsSplitAtDrawnWalls(base, lines), base, lines);
}
