import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deciderFor } from "./wallClassifier";
import { FEATURE_NAMES } from "./wallFeatures";
import { DEFAULT_WALL_MODEL_CUT, loadWallModel } from "./wallModelFile";

/**
 * ── THE COMMITTED MODEL LOADS AGAINST THIS BUILD, OR THE BUILD FAILS ──
 *
 * `models/wall-model.json` is the 28-column model trained with round 8
 * (`train-20261029-164211-signals28-round8`). `loadWallModel` refuses a model
 * whose columns do not match `FEATURE_NAMES`, and refusing is a classifier
 * that is silently off — so this asserts the committed file is ACCEPTED,
 * that `deciderFor` scores with it, and what cut it runs at. A deploy names
 * the file with `TAKEOFF_WALL_MODEL`; this is the path it names.
 */
const FILE = join(__dirname, "..", "..", "models", "wall-model.json");

describe("the committed wall model", () => {
  it("IS ACCEPTED BY loadWallModel AND SCORED BY deciderFor", () => {
    const loaded = loadWallModel({ TAKEOFF_WALL_MODEL: FILE });
    expect(loaded).not.toBeNull();
    expect(loaded!.model.features).toEqual([...FEATURE_NAMES]);
    expect(loaded!.cut).toBe(DEFAULT_WALL_MODEL_CUT);
    const score = deciderFor(loaded!.model, FEATURE_NAMES);
    expect(score).not.toBeNull();
    // a vector of zeros scores somewhere in (0, 1): the trees ran
    const p = score!(new Array(FEATURE_NAMES.length).fill(0), { x1: 0, y1: 0, x2: 1, y2: 0, lengthFeet: 10, thicknessFeet: 0.5 } as never);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });
});
