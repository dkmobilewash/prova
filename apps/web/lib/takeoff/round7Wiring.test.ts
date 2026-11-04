import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { wallsPlan, wallsTaskPages, type WallsSheet } from "@/lib/plan-ingest/walls";

// Chrome round 7. The real-set proof is `realplan/bakerNotCounted.dbtest.ts`
// (BAKER_PDF); these hold the rule and the viewer's line without the drawing.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("the sheet whose walls are on the job is the one counted", () => {
  it("A101 with walls on the job, under an older scale, keeps the count from A100's walls against its own scale", () => {
    const plan = wallsPlan([
      { pageNumber: 12, sheetNumber: "A100", title: "OVERALL FLOOR PLAN", hasScale: true, hasWalls: true },
      { pageNumber: 13, sheetNumber: "A101", title: "FLOOR PLAN", hasScale: true, hasWalls: false, onJob: true },
    ] satisfies WallsSheet[]);
    expect(plan.get(12)).toBe("same level as A101");
    expect(plan.get(13)).toBe("already found");
  });
  it("and a re-run finds A101 again, not A100", () => {
    expect(wallsTaskPages([
      { pageNumber: 12, sheetNumber: "A100", title: "OVERALL FLOOR PLAN", hasScale: true, hasWalls: true },
      { pageNumber: 13, sheetNumber: "A101", title: "FLOOR PLAN", hasScale: true, hasWalls: false, onJob: true },
    ])).toEqual([13]);
  });
  it("the walls stage finds again a sheet whose walls are on the job under any scale", () => {
    expect(read("../plan-ingest/walls.ts")).toContain("page.wallProposals.some((p) => p.calibrationId === calibration.id) || page.measurements.length > 0");
  });
});

describe("A100 says it isn't counted on load, beside the walls total", () => {
  it("renders the sentence whenever the loader names the counting sheet, before the exclusion bar", () => {
    const viewer = read("../../components/TakeoffPlanViewer.tsx");
    // In the full-screen shell both are portalled (`slot(...)`) — the sentence
    // to the canvas's notice stack, the bar beside the layers — so the order is
    // asserted through the wrapper. Still: on load, and still before the bar.
    expect(viewer).toMatch(/answerKey === undefined && notCounted !== null && \(\s*<p data-takeoff="not-counted-sheet"[^>]*>\s*\{notCounted\}\s*<\/p>\s*\)\)\}\s*\{slot\(panelOpen \? sideSlot : noticeSlot, answerKey === undefined && \(\s*<TakeoffExclusionBar/);
  });
});
