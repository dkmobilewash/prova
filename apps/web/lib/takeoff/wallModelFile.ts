import { readFileSync } from "node:fs";
import { deciderFor, type WallModel } from "./wallClassifier";
import { FEATURE_NAMES } from "./wallFeatures";

/**
 * ── THE TRAINED WALL MODEL, FROM A FILE THE NEXT RETRAIN SWAPS ──
 *
 * One model IS committed since 2026-10-29 — `apps/web/models/wall-model.json`,
 * the 28-column model trained with round 8 — so a deployment has a path to
 * name with `TAKEOFF_WALL_MODEL`; `wallModelFile.test.ts` asserts this build
 * accepts it. The file still lives wherever the deployment puts it and the
 * variable names it. The cut is the LOBO-chosen one
 * — 0.3 at the time of writing — and comes from the model file's own `cut`
 * when the trainer writes one, else `TAKEOFF_WALL_MODEL_CUT`, else the
 * default here. A retrain is therefore a new file and, if the sweep moved,
 * a new number; no code changes.
 *
 * Read on the SERVER (workspace load) and handed to the viewer, which scores
 * in the browser where the finder runs. A model whose columns do not match
 * this build's `FEATURE_NAMES` is refused, exactly as `deciderFor` refuses
 * it everywhere else: a stale model scoring reinterpreted columns is worse
 * than no model, and the refusal is logged rather than silent.
 */
export type WallModelConfig = { model: WallModel; cut: number };

/**
 * ── 0.2, AND THE MODEL NEVER HIDES A LINE ──
 *
 * Diego's decision, 2026-10-28, on the measurement that NO cut meets the
 * board's rule: there is no threshold at which this classifier recovers 3 ft
 * of real wall per 1 ft of junk by removing lines. So it is not used to remove
 * them.
 *
 * What it is used for is DEMOTE mode, which is a different question. Greying a
 * run the model doubts, with its reason, out of the total and one click from
 * coming back, is a suggestion a person can overrule in a second. A cut that
 * is wrong there costs a click; the same cut applied as a veto costs a wall
 * nobody is told about. That asymmetry is why 0.2 is defensible here and no
 * cut was defensible there.
 *
 * `TakeoffPlanViewer` holds the model only when the demote switch is on
 * (`wallModelRef.current = demote ? wallModel : null`), so this number reaches
 * nothing until an owner turns that on.
 */
export const DEFAULT_WALL_MODEL_CUT = 0.2;

export function loadWallModel(env: Record<string, string | undefined> = process.env): WallModelConfig | null {
  const file = env.TAKEOFF_WALL_MODEL ?? "";
  if (file === "") return null;
  let model: WallModel;
  try {
    model = JSON.parse(readFileSync(file, "utf8")) as WallModel;
  } catch (err) {
    console.error("[wall-model] unreadable, so nothing is demoted by it", {
      file,
      kind: err instanceof Error ? err.name : "unknown",
    });
    return null;
  }
  if (deciderFor(model, FEATURE_NAMES) === null) {
    console.error("[wall-model] refused: not gbdt-binary-v1 or its columns do not match this build's FEATURE_NAMES", {
      file,
    });
    return null;
  }
  const inFile = (model as { cut?: unknown }).cut;
  const inEnv = env.TAKEOFF_WALL_MODEL_CUT ?? "";
  const cut = typeof inFile === "number" ? inFile : inEnv !== "" ? Number(inEnv) : DEFAULT_WALL_MODEL_CUT;
  if (!(cut > 0 && cut < 1)) {
    console.error("[wall-model] refused: the cut must be a probability strictly between 0 and 1", { file, cut });
    return null;
  }
  return { model, cut };
}
