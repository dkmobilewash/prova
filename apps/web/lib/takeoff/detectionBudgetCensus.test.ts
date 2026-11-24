import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/ai/stripComments";
import { WALLS_LEASE_MS, WORK_TIMEOUT_BEFORE_LEASE_MS } from "@/lib/plan-ingest/runner";
import { FIND_BUDGET_MS, FIND_LIMIT_MS } from "./detectOffThread";
import { SHEET_DETECTION_BUDGET_MS, SHORT_FUNCTION_DETECTION_BUDGET_MS } from "./timeBudget";

/**
 * ── ONE SHEET, ONE BUDGET, WHICHEVER SIDE FINDS IT (prereg-detection-budget.md + amendment 1) ──
 *
 * The browser's Run takeoff gave a sheet 180 s and server detection 45 s, so Broadway A1.0 had walls in the browser and
 * NOTHING on the server, depending on how busy the machine was. Both now read `SHEET_DETECTION_BUDGET_MS`, and every
 * function that runs a sheet's detection either has room for it or passes the shorter budget its platform limit
 * allows. Code, not comments, is read: these files' comments quote the very lines asserted.
 */
const WEB = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const code = (rel: string) => stripComments(readFileSync(join(WEB, rel), "utf8"));
/** Seconds, from the file's one `export const maxDuration`. Two declarations, or none, fail. */
function maxDurationOf(rel: string): number {
  const found = [...code(rel).matchAll(/export const maxDuration = (\d+);/g)];
  expect(found, `${rel} declares maxDuration exactly once`).toHaveLength(1);
  return Number(found[0]![1]);
}

const WORKSPACE = "app/takeoff/[id]/page.tsx";
const ADVANCE = "app/api/plan-ingest/advance/route.ts";
const JOB_TAKEOFF_TAB = "app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx";
const SWEEP = "app/api/plan-ingest/run/route.ts";
/** Vercel Hobby's ceiling (vercel.com/docs/functions/limitations, read 2026-11-24). */
const HOBBY_MAX_S = 300;

describe("the browser and the server give a sheet the same time", () => {
  it("is the pre-registered 180 s, by one constant on both sides", () => {
    expect(SHEET_DETECTION_BUDGET_MS).toBe(180_000);
    expect(FIND_BUDGET_MS).toBe(SHEET_DETECTION_BUDGET_MS);
    expect(code("lib/takeoff/detectOffThread.ts")).toMatch(/export const FIND_BUDGET_MS = SHEET_DETECTION_BUDGET_MS;/);
    expect(code("lib/takeoff/detectWallsForCalibration.ts")).toMatch(/export const DETECTION_BUDGET_MS = SHEET_DETECTION_BUDGET_MS;/);
    // The server's default is that constant unless a caller says otherwise.
    expect(code("lib/takeoff/detectWallsForCalibration.ts")).toMatch(/clock\.budgetMs \?\? target\.budgetMs \?\? DETECTION_BUDGET_MS/);
    // And the page still hands the browser's finder that budget, with the hard stop after it.
    expect(code("components/TakeoffPlanViewer.tsx")).toMatch(/budgetMs: FIND_BUDGET_MS/);
    expect(FIND_LIMIT_MS).toBeGreaterThan(FIND_BUDGET_MS);
  });
});

describe("every function that runs a sheet's full budget has room for it", () => {
  it("the workspace, the job's takeoff tab and the whole-set advance route declare budget + 60 s, inside Hobby's ceiling", () => {
    for (const rel of [WORKSPACE, JOB_TAKEOFF_TAB, ADVANCE]) {
      const seconds = maxDurationOf(rel);
      expect(seconds * 1000, rel).toBeGreaterThanOrEqual(SHEET_DETECTION_BUDGET_MS + 60_000);
      expect(seconds, rel).toBeLessThanOrEqual(HOBBY_MAX_S);
    }
  });

  it("a whole-set WALLS slice is claimed for longer than its detection, and its work timeout ends inside the route", () => {
    const workTimeout = WALLS_LEASE_MS - WORK_TIMEOUT_BEFORE_LEASE_MS;
    expect(workTimeout).toBeGreaterThanOrEqual(SHEET_DETECTION_BUDGET_MS + 60_000);
    expect(workTimeout).toBeLessThan(maxDurationOf(ADVANCE) * 1000);
    expect(code("lib/actions/planIngest.ts")).toMatch(/leaseMs: job\.stage === "WALLS" \? WALLS_LEASE_MS : undefined/);
  });

  it("the walls stage hands its context's budget to both detection and Run-again", () => {
    expect(code("lib/plan-ingest/walls.ts").match(/budgetMs: ctx\.detectBudgetMs/g)).toHaveLength(2);
    expect(code("lib/takeoff/refreshSheetWalls.ts")).toMatch(/detectWallsForCalibration\(\{ \.\.\.target,/);
  });
});

describe("a 60 s function keeps the budget that fits in it (acceptance iv)", () => {
  it("the daily sweep passes 45 s, as it always had", () => {
    expect(SHORT_FUNCTION_DETECTION_BUDGET_MS).toBe(45_000);
    expect(maxDurationOf(SWEEP) * 1000).toBeGreaterThanOrEqual(SHORT_FUNCTION_DETECTION_BUDGET_MS + 15_000);
    expect(code(SWEEP)).toMatch(/detectBudgetMs: SHORT_FUNCTION_DETECTION_BUDGET_MS/);
  });

  it("the suggestion refresh, hosted by whichever function loads it, passes 45 s", () => {
    expect(code("lib/takeoff/suggestionRefresh.ts")).toMatch(/budgetMs: SHORT_FUNCTION_DETECTION_BUDGET_MS/);
  });
});
