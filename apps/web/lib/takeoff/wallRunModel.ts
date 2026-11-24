import { existsSync, readFileSync } from "node:fs";
import { deciderFor, type WallModel } from "./wallClassifier";
import type { RenoModels } from "./wallRunVerdicts";
import { DECISION_MODEL_ENV, loadWallModel, resolveModelPath } from "./wallModelFile";
import type { HeldModels } from "./heldOnSheet";
import { RUN_FEATURE_NAMES } from "./wallRunFeatures";

export * from "./wallRunVerdicts";
/**
 * ── THE RUN MODEL AT RUN TAKEOFF (METHOD v2, wired 2026-11-13 after its held-out exam passed) ──
 *
 * `models/wall-run-model.json` scores every run on offer (`wallRunFeatures.ts`' row). Two uses:
 *
 *  - REMOVE-ONLY: a run the hand chain would post (kept by the demolition compare, not held by
 *    the pairwise model) is held back when its score is below `RUN_REMOVE_BELOW`, exactly the rule
 *    the exam passed (held-out error 9,578 ft vs hand 10,859, no set worse).
 *  - AUTO-POST: its score rides on the stored run (`runScore`) and `wallItems.ts` posts it as
 *    "Walls (auto, high confidence)" at `MODEL_EVIDENCE.walls.autoPostAt`, for a company with the
 *    auto-post switch on.
 *
 * Behind `TAKEOFF_WALL_RUN_MODEL`: unset, nothing here runs and Run takeoff is what it was. Not
 * `TAKEOFF_WALL_MODEL`, which names the PAIRWISE model the grey-out already reads in production —
 * and which this model needs too, for its `modelScore` and `heldOffEstimate` columns.
 *
 * The feature table the model trained and was examined on (`zzWallFeatureTable.eval.ts`) calls
 * `runModelRows` below, so the exam's columns and the product's are one function.
 */
export const RUN_MODEL_ENV = "TAKEOFF_WALL_RUN_MODEL";

/**
 * ── R, THE PAIRED-RENOVATION MODEL, BEHIND `TAKEOFF_WALL_RENO_MODEL` (wired 2026-11-14, its held-out final passed) ──
 *
 * `models/wall-reno-model.json` (#1186, `scripts/wall-model/reno.py`) reads the same row as the run
 * model and decides the same way, remove-only below `RUN_REMOVE_BELOW`, but only on a renovation
 * sheet paired with its demolition plan (the table's `renovation` = 1 and `paired` = 1): there a
 * run the hand chain posts and R scores below 0.10 is held back. Held-out final, run once: 2,324 ft
 * wrong against the hand rules' 2,896, no set worse. Unset, nothing here runs.
 *
 * WITH THE RUN MODEL ON (production sets both): each decides on its own and a run either removes is
 * held — both only ever remove, so the union can only hold more than either alone. Only the run
 * model's score rides on the run (`runScore`, what auto-post reads); R's is used here and dropped.
 */
export const RENO_MODEL_ENV = "TAKEOFF_WALL_RENO_MODEL";

const cached = new Map<string, { named: string; model: WallModel | null }>();

/** A `kind: "run"` model with this build's columns, named by `envName`, or null (unset, unreadable, refused — logged once per value). */
function loadRunKind(envName: string, env: Record<string, string | undefined>): WallModel | null {
  const named = env[envName] ?? "";
  const hit = cached.get(envName);
  if (hit !== undefined && hit.named === named) return hit.model;
  let model: WallModel | null = null;
  if (named !== "") {
    const file = resolveModelPath(named);
    try {
      const read = JSON.parse(readFileSync(file, "utf8")) as WallModel & { kind?: string };
      if (read.kind === "run" && deciderFor(read, RUN_FEATURE_NAMES) !== null) model = read;
      else console.error(`[${envName}] refused: not a gbdt-binary-v1 run model with this build's RUN_FEATURE_NAMES`, { file });
    } catch (err) {
      console.error(`[${envName}] unreadable, so Run takeoff runs without it`, { file, kind: err instanceof Error ? err.name : "unknown" });
    }
  }
  cached.set(envName, { named, model });
  return model;
}

/** The run model named by `TAKEOFF_WALL_RUN_MODEL`, or null. */
export function loadRunModel(env: Record<string, string | undefined> = process.env): WallModel | null {
  return loadRunKind(RUN_MODEL_ENV, env);
}

/**
 * ── R-UNPAIRED: SHIPPED R WHERE THERE IS A DEMOLITION PLAN, R-ALL WHERE THERE IS NONE (behind TAKEOFF_RENO_UNPAIRED=1) ──
 *
 * The 2026-11-19 census of renovation junk: 10 of the 12 sets carrying 80% of it are paired with no
 * demolition plan, so R never ran there. R-ALL (R retrained on every renovation sheet's runs, same
 * columns, settings and 0.10 cut; `scripts/wall-model/reno_all.py`) failed as a replacement: worse
 * than R on the PAIRED sheets, better on the unpaired. So the paired sheets keep R exactly, and R-ALL,
 * named by `TAKEOFF_WALL_RENO_ALL_MODEL`, runs only where there is no prior. That split was chosen
 * AFTER those numbers; its only valid gate is the next release's held-out exam. Flag off, or no R-ALL
 * file: `unpaired` is null and nothing changes.
 */
export const RENO_UNPAIRED_FLAG = "TAKEOFF_RENO_UNPAIRED";
export const RENO_ALL_MODEL_ENV = "TAKEOFF_WALL_RENO_ALL_MODEL";

/** R (`TAKEOFF_WALL_RENO_MODEL`) for paired sheets and, with the flag, R-ALL for unpaired ones; null when neither is loaded. */
export function loadRenoModel(env: Record<string, string | undefined> = process.env): RenoModels | null {
  const paired = loadRunKind(RENO_MODEL_ENV, env);
  const unpaired = env[RENO_UNPAIRED_FLAG] === "1" ? loadRunKind(RENO_ALL_MODEL_ENV, env) : null;
  return paired === null && unpaired === null ? null : { paired, unpaired };
}



/**
 * ── THE MODEL-FILE CENSUS: A CONFIGURED FILE THE FUNCTION CANNOT FIND IS NAMED OUT LOUD ──
 *
 * 2026-11-24: production's TAKEOFF_WALL_MODEL resolved to a file the function could not find (the build
 * directory baked into `import.meta.url`, see `resolveModelPath`; this said "did not carry" at first, wrongly),
 * and so did the three run/reno files beside it (they only looked present because that page never reads
 * them) — so every learned hold ran silently off, and only a single once-per-process stderr line said so, on
 * a page production rarely loads. Each loader still logs its own failure at first use; this census
 * exists so ONE greppable `[model-census]` line names every configured-but-missing file together,
 * the first time any request loads models. An UNSET variable is a choice, not a failure.
 */
export type ModelFileStatus = { envName: string; named: string; resolved: string | null; ok: boolean };

/** Every env var naming a learned-model file. Built from the owning modules' constants, never retyped. */
export const MODEL_FILE_ENVS: readonly string[] = [
  ...new Set([...Object.values(DECISION_MODEL_ENV), RUN_MODEL_ENV, RENO_MODEL_ENV, RENO_ALL_MODEL_ENV]),
];

export function modelFileCensus(env: Record<string, string | undefined> = process.env): ModelFileStatus[] {
  return MODEL_FILE_ENVS.map((envName) => {
    const named = env[envName] ?? "";
    if (named === "") return { envName, named, resolved: null, ok: true };
    const resolved = resolveModelPath(named);
    return { envName, named, resolved, ok: existsSync(resolved) };
  });
}

let censusSaid = false;

/**
 * The models `heldOnSheet` decides with, loaded the way detection always loaded them: the pairwise model for the
 * 0.55 hold only when the company keeps demoted walls on; the pairwise model again for the run columns whenever the
 * run model or R is configured; each null when its file is unset or unreadable. Detection calls this; the workspace
 * calls it too and hands the result to the viewer as data (`liveHeldModels`), so both sides decide with one set.
 */
export function serverHeldModels(holdApplies: boolean, env: Record<string, string | undefined> = process.env): HeldModels {
  if (!censusSaid) {
    censusSaid = true;
    for (const miss of modelFileCensus(env).filter((s) => !s.ok)) {
      console.error(`[model-census] ${miss.envName} names a model file this function cannot find — that model is OFF`, {
        named: miss.named,
        resolved: miss.resolved,
      });
    }
  }
  const run = loadRunModel(env);
  const reno = loadRenoModel(env);
  const pairwise = loadWallModel(env)?.model ?? null;
  return { hold: holdApplies ? pairwise : null, pair: run === null && reno === null ? null : pairwise, run, reno };
}
