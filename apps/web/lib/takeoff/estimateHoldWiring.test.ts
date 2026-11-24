import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The stage and the viewer cannot be driven here. wallItems.dbtest proves the
// item and the estimate skip; this pins the hand-offs nothing else would catch.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("doubted walls reach the hold", () => {
  it("detection works them out only when the company has the switch on", () => {
    const detect = read("./detectWallsForCalibration.ts");
    // Since prereg-live-list-parity.md the hold is decided in `heldOnSheet` (detection and the live list both call
    // it); the company switch still decides whether the pairwise 0.55 hold applies.
    expect(detect).toContain("const models = serverHeldModels(company?.demotedWallsOff === false);");
    expect(read("./wallRunModel.ts")).toContain("return { hold: holdApplies ? pairwise : null,");
    expect(read("./heldOnSheet.ts")).toContain("models.hold === null ? [] : runsHeldOffEstimate(models.hold, input.kept, input.pairings, input.feetPerUnit, input.scanned)");
    expect(detect).toMatch(/kept: offered\.offeredRuns,\s+pairings: scored,/);
  });
  it("the walls stage hands them to the wall items", () => {
    // Through the one posting step a fresh detection and a found-again sheet share.
    const walls = read("../plan-ingest/walls.ts");
    expect(walls).toMatch(/postAndRooms\(task\.pageNumber, boundary\?\.held \?\? \[\],/);
    expect(walls).toMatch(/postAndRooms\(task\.pageNumber, again\.held \?\? \[\],/);
    expect(walls).toMatch(/writeWallItems\(\{[^}]*pageNumber, held,/);
  });
  it("the viewer lists them, outside the Quantities panel, with one click to include", () => {
    const viewer = read("../../components/TakeoffPlanViewer.tsx");
    expect(viewer).toContain("m.label === HELD_LABEL");
    expect(viewer).toContain("await confirmHeldWall(jobId, id)");
    expect(viewer.indexOf("<TakeoffHeldWalls")).toBeLessThan(viewer.indexOf('data-takeoff="found-walls"'));
  });
});
