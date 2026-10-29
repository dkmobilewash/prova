import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEATURE_NAMES } from "./wallFeatures";

/**
 * ── THE SHIPPED MODEL'S COLUMNS ARE THIS BUILD'S COLUMNS, OR THE BUILD FAILS ──
 *
 * `loadWallModel` refuses a model whose columns do not match `FEATURE_NAMES`,
 * and refusing means the classifier is silently OFF except for one console
 * line. A 28-column model deployed against a 24-column build greys nothing
 * and nobody sees it. So the 28 names the shipped model
 * (`train-20261029-164211-signals28-round8/wall-model.json`) was trained on
 * are written here as a LITERAL, in order, and this build's `FEATURE_NAMES`
 * must equal them exactly: adding, removing or reordering a column is a new
 * model, and this test is where that is said. When `TAKEOFF_WALL_MODEL`
 * names a file, its columns are checked against the same list too.
 */
export const SHIPPED_MODEL_COLUMNS = [
  "thicknessVsCommon", "thicknessPercentile", "lengthPercentile", "lengthToSheetSpan", "scheduledDeltaShare", "hasSchedule",
  "isScheduled", "faceRatio", "overlapShare", "isCurved", "offOrthogonalDeg", "penDelta",
  "penPercentile", "hasPenWidths", "layerSaysWall", "layerSaysNotWall", "layerUnknown", "parallelNeighbours",
  "neighbourSpacingCv", "hasNeighbourSpacing", "nearestNeighbourThicknessRatio", "hasNearestNeighbour", "densityPercentile", "inHatchSeries",
  "wordsBetween", "dashedFaces", "runsMeeting", "twinFaces",
] as const;

describe("the shipped wall model's columns", () => {
  it("ARE EXACTLY THIS BUILD'S FEATURE_NAMES, IN ORDER", () => {
    expect([...FEATURE_NAMES]).toEqual([...SHIPPED_MODEL_COLUMNS]);
  });

  it("match the model file named by TAKEOFF_WALL_MODEL, when one is named", () => {
    const file = process.env.TAKEOFF_WALL_MODEL ?? "";
    if (file === "" || !existsSync(file)) return;
    const model = JSON.parse(readFileSync(file, "utf8")) as { features?: string[] };
    expect(model.features).toEqual([...SHIPPED_MODEL_COLUMNS]);
  });
});
