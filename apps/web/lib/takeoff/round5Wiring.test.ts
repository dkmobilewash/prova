import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sameRun } from "./estimateHold";

// Chrome round 5. The viewer cannot be driven here (the check crops a canvas);
// these pin the hand-offs that broke. The estimate and refresh halves have
// their own behaviour tests (`takeoff-review-scope.dbtest.ts`, `refreshSheetWalls.test.ts`).
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("a review decision moves one run", () => {
  it("the actions sync only the items the run left and joined, never the whole takeoff", () => {
    const actions = read("../actions/takeoff.ts");
    const confirm = actions.slice(actions.indexOf("export async function confirmHeldWall"), actions.indexOf("export async function recordTakeoffPlan"));
    expect(confirm).not.toContain("syncTakeoffItemLines(");
    expect(confirm.match(/syncReviewedItems\(/g)).toHaveLength(2);
  });
});

describe("the review finds the wall it is dropping", () => {
  it("matches within a millionth of the page and either way round, and not beyond", () => {
    const run = { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.2 };
    expect(sameRun(run, { x1: 0.1 + 4e-7, y1: 0.2, x2: 0.3, y2: 0.2 - 4e-7 })).toBe(true);
    expect(sameRun(run, { x1: 0.3, y1: 0.2, x2: 0.1, y2: 0.2 })).toBe(true);
    expect(sameRun(run, { x1: 0.1 + 1e-4, y1: 0.2, x2: 0.3, y2: 0.2 })).toBe(false);
  });
  it("the viewer matches by it, and a dropped wall leaves the sheet's total at find time and when a set review drops it", () => {
    const viewer = read("../../components/TakeoffPlanViewer.tsx");
    expect(viewer).toContain("sameRun({ x1: m.xs[0]!, y1: m.ys[0]!, x2: m.xs[1]!, y2: m.ys[1]! }, run)");
    expect(viewer).toContain("!dropped.has(i) && !droppedOnJob(r)");
    expect(viewer).toContain("regroup(runs.filter((r, at) => !doubted?.has(at) && !droppedOnJob(r)))");
    expect(viewer).toMatch(/useEffect\(\(\) => \{\n\s+if \(droppedKeyWas\.current === droppedKey\) return;[\s\S]{0,200}rebuildFound\(/);
  });
});

describe("the not-walls list leaves room for the drawing", () => {
  it("is capped and scrolls", () => {
    const viewer = read("../../components/TakeoffPlanViewer.tsx");
    expect(viewer).toMatch(/data-takeoff="demoted-list" className="[^"]*\bmax-h-24\b[^"]*\boverflow-y-auto\b/);
  });
});

describe("a same-level sheet in the whole-set summary", () => {
  it("reads 'found N, not counted: same level as …' and is not counted as a sheet with walls", () => {
    const panel = read("../../components/WholeSetTakeoffPanel.tsx");
    expect(panel).toContain("`found ${formatFeetInches(row.status.feet)}, not counted: ${row.status.notCounted}`");
    expect(panel).toContain("const found = summary.filter(counted);");
  });
});
