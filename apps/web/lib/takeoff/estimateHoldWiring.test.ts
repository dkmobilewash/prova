import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The stage and the viewer cannot be driven here. wallItems.dbtest proves the
// item and the estimate skip; this pins the hand-offs nothing else would catch.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("doubted walls reach the hold", () => {
  it("detection works them out only when the company has the switch on", () => {
    const detect = read("./detectWallsForCalibration.ts");
    expect(detect).toContain('company?.demotedWallsOff === false ? loadWallModel(process.env) : null');
    expect(detect).toMatch(/runsHeldOffEstimate\(config\.model, offered\.offeredRuns, scored, target\.feetPerUnit, raster !== null\)/);
  });
  it("the walls stage hands them to the wall items", () => {
    expect(read("../plan-ingest/walls.ts")).toMatch(/writeWallItems\(\{[^}]*held: boundary\?\.held \?\? \[\],/);
  });
  it("the viewer lists them, outside the Quantities panel, with one click to include", () => {
    const viewer = read("../../components/TakeoffPlanViewer.tsx");
    expect(viewer).toContain("m.label === HELD_LABEL");
    expect(viewer).toContain("await confirmHeldWall(jobId, id)");
    expect(viewer.indexOf("<TakeoffHeldWalls")).toBeLessThan(viewer.indexOf('data-takeoff="found-walls"'));
  });
});
