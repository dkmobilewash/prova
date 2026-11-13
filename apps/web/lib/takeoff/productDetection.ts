import { inPageWidthUnits } from "./findWallsOnSheet";
import { detectForSheet, type SheetDetectInput } from "./offeredCandidates";
import { printedTagCodes, tagVocabulary } from "./planTextTags";
import { pagesToSample } from "./sheetTemplate";
import type { StrokeSegment, WallCandidate } from "./wallVectors";
import type { MatchableWallType } from "./wallTypeMatch";

/**
 * ── ONE DETECTION INPUT FOR THE PRODUCT AND FOR TRAINING (METHOD v2) ──
 *
 * A model scores what the product hands it, so it has to be trained on exactly that. It was not:
 * training rows came from `findWallsOnSheet` on the whole sheet with no types, no vocabulary and no
 * template, while the product scores `detectForSheet` per plan view — and every sheet-relative
 * feature (the percentiles, `thicknessVsCommon`, `twinFaces`, neighbour stats) came out different on
 * all 3,636 candidates compared (`zzFeatureParity.eval.ts`, Baker A101, Totem A2.1, Falafel A2.20).
 *
 * So both call THIS: `detectWallsForCalibration` (the product) and `zzTrainRows.eval.ts` (the rows
 * a model is trained on). `productDetection.test.ts` pins that they agree byte for byte on the
 * repo's own sample sheet in every CI run, and the eval checks real sheets.
 */
export type ProductDetectionInput = Pick<SheetDetectInput, "segments" | "textItems" | "pageSize" | "feetPerUnit" | "scanned"> & {
  /** The company's wall types (training passes the ones the product would have; a new company has none). */
  wallTypes: readonly MatchableWallType[];
  /** The set's legend codes when one was read, else null (see `tagVocabulary`). */
  legendCodes: readonly string[] | null;
  /** The set's template, from `sampledSheetsFor`; null skips that pass. */
  sampledSheets: StrokeSegment[][] | null;
  /** False pairs without the types' thicknesses (`DetectTarget.pairWithThicknesses`). */
  pairWithThicknesses?: boolean;
};

/** The symbol-tag vocabulary: the company's codes, the legend's when read, the sheet's printed ones (`tagVocabulary`). */
export function vocabularyFor(input: Pick<ProductDetectionInput, "wallTypes" | "legendCodes" | "textItems" | "segments">): string[] {
  return tagVocabulary(
    input.wallTypes.map((type) => type.code),
    input.legendCodes,
    // The sheet's own printed codes: Totem's 1, 1A, 2A, 2B and 3B (`printedTagCodes`).
    printedTagCodes(input.textItems, input.segments),
  );
}

export function productDetection(
  input: ProductDetectionInput,
  onCandidate?: (features: readonly number[], wall: WallCandidate) => void,
): ReturnType<typeof detectForSheet> {
  const vocabulary = vocabularyFor(input);
  const wallTypes = input.pairWithThicknesses === false ? input.wallTypes.map((type) => ({ ...type, thicknessIn: null })) : [...input.wallTypes];
  return detectForSheet({
    segments: input.segments,
    textItems: input.textItems,
    ...(onCandidate === undefined ? {} : { onCandidate }),
    pageSize: input.pageSize,
    feetPerUnit: input.feetPerUnit,
    wallTypes,
    scanned: input.scanned ?? false,
    sampledSheets: input.sampledSheets,
    ...(vocabulary.length === 0 ? {} : { planText: { legendCodes: vocabulary } }),
  });
}

/**
 * THE SET'S TEMPLATE, read off other sheets: each sampled page converted in ITS OWN page width.
 * Null when any page fails or time runs out — the fail-safe is "no template filter", never "no walls".
 * The sheet itself is one of the samples; `own` is its strokes, already read, never parsed twice.
 */
export async function sampledSheetsFor(input: {
  pageCount: number;
  pageNumber: number;
  own: { segments: readonly StrokeSegment[]; widthPt: number } | null;
  read: (pageNumber: number) => Promise<{ segments: readonly StrokeSegment[]; widthPt: number }>;
  outOfTime?: () => boolean;
  onOutOfTime?: (sampled: number) => void;
}): Promise<StrokeSegment[][] | null> {
  const sampled: StrokeSegment[][] = [];
  for (const pageNumber of pagesToSample(input.pageCount, input.pageNumber)) {
    if (input.outOfTime?.() === true) {
      input.onOutOfTime?.(sampled.length);
      return null;
    }
    try {
      const other = pageNumber === input.pageNumber && input.own !== null ? input.own : await input.read(pageNumber);
      sampled.push(other.segments.map(inPageWidthUnits(other.widthPt)));
    } catch {
      return null;
    }
  }
  return sampled;
}
