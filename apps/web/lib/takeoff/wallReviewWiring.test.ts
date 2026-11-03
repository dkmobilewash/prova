import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The viewer cannot run a Find in happy-dom, so this pins the hand-offs; the
// order, the cursor, undo and the zoom are tested in wallReview.test.ts, and a
// dropped wall leaving the estimate in wallItems.dbtest.ts.
const viewer = readFileSync(new URL("../../components/TakeoffPlanViewer.tsx", import.meta.url), "utf8");

describe("Review walls in the viewer", () => {
  it("orders the runs by likely junk feet, the default, with the held ones last", () => {
    expect(viewer).toMatch(/startReview\(reviewOrder\(runs\.map\(\(r, at\) => \(\{ at, held: measurementForRun\(r\)\?\.label === HELD_LABEL, score: reviewScores\.current\[at\] \?\? null, lengthFeet: r\.lengthFeet \}\)\)\)\)/);
  });
  it("a decision on a posted wall goes to the server before the screen moves on", () => {
    expect(viewer.indexOf("await reviewWall(jobId, posted.id, kind)")).toBeLessThan(viewer.indexOf("const next = decide(review, kind);"));
  });
  it("undo puts the wall back where it was", () => {
    expect(viewer).toContain('await reviewWall(jobId, server.measurementId, "restore", server.was)');
  });
  it("a dropped run leaves the found list, and each run is zoomed to", () => {
    expect(viewer).toMatch(/rebuildFound\(droppedRuns\(next\)\)/);
    expect(viewer).toMatch(/viewOfRun\(reviewRun, pageSize/);
  });
});
