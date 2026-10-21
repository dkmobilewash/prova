import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planTextCacheDir, planTextKeys, readPlanTextCache, writePlanTextCache } from "./planTextCache";

describe("the plan-text file cache", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "plan-text-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("round-trips a value by key, and a key with odd characters still lands in the dir", () => {
    const key = planTextKeys.result("plan/with spaces", 3);
    writePlanTextCache(key, { a: 1 }, dir);
    expect(readPlanTextCache<{ a: number }>(key, dir)).toEqual({ a: 1 });
    expect(readPlanTextCache("nothing-here", dir)).toBeNull();
  });

  it("treats a half-written file as a miss rather than a crash", () => {
    writeFileSync(join(dir, "legend-p1.json"), "{ not json", "utf8");
    expect(readPlanTextCache(planTextKeys.legend("p1"), dir)).toBeNull();
  });

  it("takes its directory from PLAN_TEXT_CACHE_DIR, else the temp dir", () => {
    expect(planTextCacheDir({ PLAN_TEXT_CACHE_DIR: "/x" } as unknown as NodeJS.ProcessEnv)).toBe("/x");
    expect(planTextCacheDir({} as unknown as NodeJS.ProcessEnv)).toBe(join(tmpdir(), "prova-plan-text"));
  });
});
