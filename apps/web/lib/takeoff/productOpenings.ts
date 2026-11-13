import { doorArcCandidates, type DoorArcCandidate, type DoorSymbol } from "./doorWindowSymbols";
import { doorMarkTexts, doorsInScope, WINDOW_TAG } from "./doorsWindows";
import type { ExistingDoor, ExistingDoorEvidence } from "./existingDoors";
import { doorFeatureRows, type PlacedText, type SheetContext } from "./openingFeatures";
import { tagSymbols } from "./tagSymbols";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── THE OPENINGS' INPUTS, ONE WAY FOR THE PRODUCT AND FOR TRAINING (METHOD v2, doors) ──
 *
 * The door model's rows were built on `detectForSheet` with no template, types or vocabulary, over
 * the finder's raw walls — while the product (`rooms.ts`) finds doors and windows against the runs the
 * stage STORED, on the page's own strokes. Every door feature that reads its wall (onWall, thickness,
 * exterior, the wall-lines band, the marked share) came from a different wall set. So `rooms.ts` and
 * `zzOpeningFeatureTable.eval.ts` both build their inputs here; `productOpenings.test.ts` pins it.
 */
export type OpeningInputs = {
  /** Strokes in page-width units. */
  segments: StrokeSegment[];
  /** The same strokes in page points, for the mark symbols. */
  segmentsPt: StrokeSegment[];
  /** The stored runs as wall candidates, their length recomputed at this scale. */
  walls: WallCandidate[];
  widthPt: number;
  feetPerUnit: number;
};

type StoredRunLike = { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number };

/**
 * The stored runs and the page's strokes, as `rooms.ts` hands them to `doorsAndWindowsForSheet`. With
 * `segmentsInUnits` (the whole-set run's own detection, `DetectedBoundary.segments`) those are the
 * strokes; without, the page's strokes in page-width units (Run takeoff and a retry).
 */
export function openingInputs(input: { runs: readonly StoredRunLike[]; feetPerUnit: number; widthPt: number; segmentsPt?: readonly StrokeSegment[]; segmentsInUnits?: readonly StrokeSegment[] }): OpeningInputs {
  const W = input.widthPt;
  const segments = input.segmentsInUnits !== undefined ? [...input.segmentsInUnits] : (input.segmentsPt ?? []).map((s) => ({ ...s, x1: s.x1 / W, y1: s.y1 / W, x2: s.x2 / W, y2: s.y2 / W }));
  const segmentsPt = input.segmentsInUnits !== undefined ? segments.map((s) => ({ ...s, x1: s.x1 * W, y1: s.y1 * W, x2: s.x2 * W, y2: s.y2 * W })) : [...(input.segmentsPt ?? [])];
  const walls = input.runs.map((r) => ({ ...r, lengthFeet: Math.hypot(r.x2 - r.x1, r.y2 - r.y1) * input.feetPerUnit })) as unknown as WallCandidate[];
  return { segments, segmentsPt, walls, widthPt: W, feetPerUnit: input.feetPerUnit };
}

/** Whether a sheet's words say it is a renovation — the door model's `renovation` input. */
export function sheetIsRenovation(textItems: readonly { str: string }[]): boolean {
  const words = textItems.map((t) => t.str).join(" ");
  return /\(E\)/i.test(words) || (words.match(/\bEXIST/gi) ?? []).length >= 3 || /RENOVATION|REMODEL|TENANT IMPROVEMENT|\bDEMO/i.test(words);
}

/**
 * Every door the finder draws on the sheet (`doorSymbols`, before the marked-share filter), with its
 * feature row (`DOOR_FEATURE_NAMES`), the arcs, the marks and which of them the product keeps — the
 * same doors and marks `doorsAndWindowsForSheet` reads from these inputs.
 */
export function productDoorRows(input: OpeningInputs & { textPt: readonly { str: string; x: number; y: number; width: number; height: number }[]; existing?: ExistingDoorEvidence }): {
  doors: DoorSymbol[];
  /** Set aside as existing before any row is written: the product never offers them. */
  existing: ExistingDoor[];
  arcs: DoorArcCandidate[];
  marks: PlacedText[];
  tags: PlacedText[];
  kept: Set<DoorSymbol>;
  context: SheetContext;
  rows: number[][];
} {
  const W = input.widthPt;
  const symbols = tagSymbols({ segments: input.segmentsPt, text: input.textPt, unitsPerPaperInch: 72 });
  const marks = doorMarkTexts(symbols, W);
  const tags = symbols.filter((s) => s.rejected === null && WINDOW_TAG.test(s.text.trim().toUpperCase())).map((s) => ({ text: s.text.trim().toUpperCase(), x: s.x / W, y: s.y / W }));
  const words: PlacedText[] = input.textPt.map((t) => ({ text: t.str, x: (t.x + t.width / 2) / W, y: (t.y - t.height / 2) / W }));
  const context: SheetContext = { segments: input.segments, walls: input.walls, words, feetPerUnit: input.feetPerUnit, widthPt: W, renovation: sheetIsRenovation(input.textPt) };
  const arcs = doorArcCandidates(input.segments, input.walls, input.feetPerUnit);
  // The doors the product offers: existing ones set aside first (`doorsInScope`), as `doorsAndWindowsForSheet` does.
  const scope = doorsInScope({ segments: input.segments, walls: input.walls, feetPerUnit: input.feetPerUnit, textPt: input.textPt, widthPt: W, marks, ...(input.existing === undefined ? {} : { existing: input.existing }) });
  const aside = new Set(scope.existing.map((e) => e.door));
  const doors = scope.all.filter((d) => !aside.has(d));
  const kept = new Set(scope.doors);
  return { doors, existing: scope.existing, arcs, marks, tags, kept, context, rows: doorFeatureRows({ ...context, doors, arcs, marks, keptByProduct: kept }) };
}
