import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * ── A FILE CACHE STANDING IN FOR THREE TABLES ──
 *
 * The legend read, the door-schedule read and the per-sheet plan-text result
 * each want a row: they are read once per set or per calibration, cost a
 * model call or a second of geometry, and the screen reads them back. They
 * were built under a no-migrations rule, so they live as JSON files under
 * `PLAN_TEXT_CACHE_DIR` (default: the OS temp dir), keyed by plan and page.
 *
 * What that costs, said plainly: the cache is per machine, survives a restart
 * only while the temp dir does, and is invisible to the database. A deploy
 * with two instances reads two caches.
 *
 * The migration this wants (`NOTES.md`, "Wiring plan"):
 *   - `PlanLegendProposal` (planId, pageNumber, codes, proposals Json, reason,
 *     confidence, model, promptVersion, status) — a sibling of
 *     `PlanScheduleProposal`, which already holds door schedules;
 *   - `TakeoffPlanTextRead` (planId, pageNumber, calibrationId, doors Json,
 *     typed Json, computedAt);
 *   - `TakeoffWallProposalSource` gains `PROPAGATED`.
 */
export function planTextCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PLAN_TEXT_CACHE_DIR ?? join(tmpdir(), "prova-plan-text");
}

export const planTextKeys = {
  legend: (planId: string) => `legend-${planId}`,
  doors: (planId: string) => `doors-${planId}`,
  result: (planId: string, pageNumber: number) => `result-${planId}-p${pageNumber}`,
};

function fileFor(key: string, dir: string): string {
  return join(dir, `${key.replace(/[^A-Za-z0-9_-]+/g, "_")}.json`);
}

export function readPlanTextCache<T>(key: string, dir: string = planTextCacheDir()): T | null {
  const at = fileFor(key, dir);
  if (!existsSync(at)) return null;
  try {
    return JSON.parse(readFileSync(at, "utf8")) as T;
  } catch {
    // A half-written or hand-edited file is a miss, not a crash: the caller
    // recomputes and overwrites it.
    return null;
  }
}

export function writePlanTextCache(key: string, value: unknown, dir: string = planTextCacheDir()): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(fileFor(key, dir), JSON.stringify(value, null, 1), "utf8");
}
