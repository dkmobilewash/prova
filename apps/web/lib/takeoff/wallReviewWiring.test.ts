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

describe("Review walls across the set", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  it("the stage stores each run's score with the walls, and the store reads it back", () => {
    expect(read("./detectWallsForCalibration.ts")).toContain("offered.offeredRuns[at]!.modelScore = score");
    const store = read("./wallProposal.ts");
    expect(store).toContain("stored.modelScore = run.modelScore");
  });
  it("the load builds one queue over every sheet, and the workspace reviews it and jumps to each sheet", () => {
    expect(read("./workspaceLoad.ts")).toContain("wallReviewQueue: setReviewOrder(wallReviewItems)");
    const ws = read("../../components/TakeoffWorkspace.tsx");
    // The rail's highlight AND the viewer: setPage alone moved only the rail (the takeoff spec, R5-11).
    expect(ws).toContain("setPage(setCurrent.pageNumber);");
    expect(ws).toContain('document.dispatchEvent(new CustomEvent("takeoff-goto", { detail: { page: setCurrent.pageNumber } }));');
    // The job's review queue (`reviewQueue.ts`) focuses through the same prop when this review is off.
    expect(ws).toContain("focusRun={setCurrent ?? queueFocus}");
    expect(ws).toContain("await reviewWall(jobId, setCurrent.measurementId, kind)");
    expect(ws).toContain('await reviewWall(jobId, last.id, "restore", last.was)');
  });
});
