import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deciderFor, type WallModel } from "./wallClassifier";
import { FEATURE_NAMES } from "./wallFeatures";
import type { ModelDecision } from "./autoPost";

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

/**
 * ── READ ONCE PER PROCESS, AND SAY SO ONCE ──
 *
 * `workspaceLoad` calls this on every takeoff page load, and the grey-out is
 * on for every company now — so an un-memoised read is a readFileSync and a
 * JSON.parse per request, and a REFUSAL is a console.error per request. One
 * bad deploy would then write the same line thousands of times and bury
 * everything else in the log.
 *
 * Keyed on the resolved path rather than a bare boolean, so a test that passes
 * its own env still gets its own answer and this stays testable.
 */
let cached: { key: string; config: WallModelConfig | null } | null = null;

export function loadWallModel(env: Record<string, string | undefined> = process.env): WallModelConfig | null {
  // Keyed on BOTH values that decide the answer. Keying on the path alone made
  // a second call with a different cut return the first call's config — which
  // the existing tests caught immediately, because they vary the cut over one
  // fixture file.
  const key = `${env.TAKEOFF_WALL_MODEL ?? ""}\u0000${env.TAKEOFF_WALL_MODEL_CUT ?? ""}`;
  if (cached !== null && cached.key === key) return cached.config;
  const answer = readWallModel(env);
  cached = { key, config: answer };
  return answer;
}

/** Forget the memoised answer. For tests, which change the env between cases. */
export function forgetWallModel(): void {
  cached = null;
}

/**
 * ── A RELATIVE PATH RESOLVES AT RUN TIME, FROM THE WORKING DIRECTORY FIRST ──
 *
 * 2026-11-24 production outage, #860 to this fix: this used ONLY
 * `fileURLToPath(import.meta.url)`, and webpack REPLACES `import.meta.url` in the server bundle
 * with the BUILD machine's file URL (the local bundle carries
 * `file:///Users/…/apps/web/lib/takeoff/wallModelFile.ts` literally). On Vercel that is
 * `/vercel/path0/apps/web`, a directory that exists during the build and not in the function, so
 * every relative model path pointed at nothing: production's `[walls-model] unreadable` named
 * `/vercel/path0/apps/web/models/wall-model.json` and, under the older spelling,
 * `/vercel/path0/apps/web/apps/web/models/…`. The files WERE traced into the function; the
 * resolver looked somewhere else. All four learned models resolve here, so all four were off.
 *
 * So the roots are computed when the function RUNS: the working directory (the repo root on
 * Vercel, apps/web under `next start` and vitest), apps/web under it, and the repo root above it. The baked directory stays
 * last, for a laptop where the build machine and the runtime are the same machine. Both env
 * spellings (`models/…` and `apps/web/models/…`) land on the same file from either root.
 *
 * An ABSOLUTE path is used as given: that is what the tests pass, and what a
 * laptop or a mounted volume uses. Nothing found: the first candidate, so the log names a real place.
 */
const BUILT_APP_DIR = join(fileURLToPath(import.meta.url), "..", "..", ".."); // …/apps/web AT BUILD TIME

export function resolveModelPath(file: string, cwd: string = process.cwd(), builtAppDir: string = BUILT_APP_DIR): string {
  if (isAbsolute(file)) return file;
  const roots = [cwd, join(cwd, "apps", "web"), join(cwd, "..", ".."), builtAppDir, join(builtAppDir, "..", "..")];
  const candidates = roots.map((root) => join(root, file));
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/**
 * ── ONE READER FOR EVERY LEARNED DECISION (METHOD v2, part 3) ──
 * Walls read `TAKEOFF_WALL_MODEL` today; the second's type and door models plug in by naming their
 * file in `TAKEOFF_TYPE_MODEL` / `TAKEOFF_DOOR_MODEL` and passing their build's feature columns. The
 * same contract for all: `gbdt-binary-v1`, columns equal to the build's in order, else refused and
 * logged once — a model scoring reinterpreted columns is worse than no model. Whether a score then
 * POSTS is `modelAutoPostAt` in `autoPost.ts`, read off that decision's measured evidence.
 */
export const DECISION_MODEL_ENV: Record<ModelDecision, string> = { walls: "TAKEOFF_WALL_MODEL", types: "TAKEOFF_TYPE_MODEL", doors: "TAKEOFF_DOOR_MODEL" };

export function readDecisionModel(decision: ModelDecision, features: readonly string[], env: Record<string, string | undefined> = process.env): { model: WallModel; file: string } | null {
  const named = env[DECISION_MODEL_ENV[decision]] ?? "";
  if (named === "") return null;
  const file = resolveModelPath(named);
  let model: WallModel;
  try {
    model = JSON.parse(readFileSync(file, "utf8")) as WallModel;
  } catch (err) {
    console.error(`[${decision}-model] unreadable, so nothing is decided by it`, { file, kind: err instanceof Error ? err.name : "unknown" });
    return null;
  }
  if (deciderFor(model, features) === null) {
    console.error(`[${decision}-model] refused: not gbdt-binary-v1 or its columns do not match this build's features`, { file });
    return null;
  }
  return { model, file };
}

function readWallModel(env: Record<string, string | undefined>): WallModelConfig | null {
  const read = readDecisionModel("walls", FEATURE_NAMES, env);
  if (read === null) return null;
  const { model, file } = read;
  const inFile = (model as { cut?: unknown }).cut;
  const inEnv = env.TAKEOFF_WALL_MODEL_CUT ?? "";
  const cut = typeof inFile === "number" ? inFile : inEnv !== "" ? Number(inEnv) : DEFAULT_WALL_MODEL_CUT;
  if (!(cut > 0 && cut < 1)) {
    console.error("[wall-model] refused: the cut must be a probability strictly between 0 and 1", { file, cut });
    return null;
  }
  return { model, cut };
}
