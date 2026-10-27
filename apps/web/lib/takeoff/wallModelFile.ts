import { readFileSync } from "node:fs";
import { deciderFor, type WallModel } from "./wallClassifier";
import { FEATURE_NAMES } from "./wallFeatures";

/**
 * ── THE TRAINED WALL MODEL, FROM A FILE THE NEXT RETRAIN SWAPS ──
 *
 * No model is committed (`NOTES.md`): the file lives wherever the deployment
 * puts it and `TAKEOFF_WALL_MODEL` names it. The cut is the LOBO-chosen one
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

export const DEFAULT_WALL_MODEL_CUT = 0.3;

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
