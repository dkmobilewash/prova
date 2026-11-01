import { roomBoundary } from "./roomBoundary";
import { roomSeals } from "./roomSeals";
import { roomsSplitAtDrawnWalls, type RoomsFromWallsResult } from "./roomsFromWalls";
import type { PositionedText } from "./roomTags";
import type { StrokeSegment } from "./wallVectors";

type Line = { x1: number; y1: number; x2: number; y2: number };

/** How far past each end a split runs, feet, so a line stopped just short of a wall still meets it. */
const SPLIT_OVERRUN_FEET = 1;

function reachingWalls(line: Line, feetPerUnit: number): Line {
  const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1) || 1;
  const ux = ((line.x2 - line.x1) / length) * (SPLIT_OVERRUN_FEET / feetPerUnit), uy = ((line.y2 - line.y1) / length) * (SPLIT_OVERRUN_FEET / feetPerUnit);
  return { x1: line.x1 - ux, y1: line.y1 - uy, x2: line.x2 + ux, y2: line.y2 + uy };
}

/**
 * A sheet's rooms from what a Find left behind. The one path, so the viewer and
 * the whole-set run cannot disagree about a sheet: the boundary, the doors that
 * seal it, and the sheet's own lines for a region that leaked. `segments` and
 * `doorLeaves` are in page-width units, and empty when no Find has read them.
 */
export function sheetRooms(input: {
  pairings: Parameters<typeof roomBoundary>[0]["pairings"];
  runs: Parameters<typeof roomBoundary>[0]["runs"];
  drawn: Parameters<typeof roomBoundary>[0]["drawn"];
  segments: readonly StrokeSegment[];
  doorLeaves: readonly Line[];
  /** The estimator's own lines across a region. Each closes like a wall. */
  splits?: readonly Line[];
  feetPerUnit: number;
  text: readonly PositionedText[];
  widthPt: number;
}): RoomsFromWallsResult {
  const { feetPerUnit, segments } = input;
  const walls = roomBoundary({ pairings: input.pairings, runs: input.runs, drawn: input.drawn });
  const doorSeals = [...(segments.length > 0 ? roomSeals(walls, segments, feetPerUnit) : []), ...(input.splits ?? []).map((s) => reachingWalls(s, feetPerUnit))];
  return roomsSplitAtDrawnWalls({ walls, feetPerUnit, text: input.text, widthPt: input.widthPt, doorSeals }, [...segments, ...input.doorLeaves]);
}
