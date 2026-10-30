import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

/**
 * ── EVERY MODEL FILE IN THE REPO, NOT ONLY THE ONE THE DEPLOY NAMES ──
 *
 * The e2e suite's invented model (`e2e/fixtures/wall-model.invented.json`)
 * is a second model file, and when `FEATURE_NAMES` grew to 28 it kept its
 * 24 columns: `loadWallModel` refused it, the demote specs had nothing to
 * demote by, and #851 went red on CI while the guard above was green —
 * "a completeness check cannot see a second list", one file over. So every
 * JSON under apps/web that declares `gbdt-binary-v1` is held to the same
 * columns, and the walk asserts it found at least the two it knows about.
 */
function modelFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".next") || name === ".git") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) modelFiles(full, out);
    else if (name.endsWith(".json") && st.size < 50_000_000) {
      let text: string;
      try { text = readFileSync(full, "utf8"); } catch { continue; }
      if (text.includes('"gbdt-binary-v1"')) out.push(full);
    }
  }
  return out;
}

describe("every gbdt-binary-v1 model file in apps/web", () => {
  it("CARRIES THIS BUILD'S COLUMNS, IN ORDER — the committed model and the e2e fixture both", () => {
    const files = modelFiles(join(__dirname, "..", ".."));
    expect(files.length, "the walk found fewer model files than the repo is known to hold").toBeGreaterThanOrEqual(2);
    for (const file of files) {
      const model = JSON.parse(readFileSync(file, "utf8")) as { features?: string[] };
      expect(model.features, file).toEqual([...SHIPPED_MODEL_COLUMNS]);
    }
  });
});
