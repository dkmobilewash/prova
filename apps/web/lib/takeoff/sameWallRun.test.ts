import { describe, expect, it } from "vitest";
import { matchWallRuns, nearestWallRun, sameWallRun } from "./runMatch";

/**
 * ── A CONTRACTOR'S DECISION MUST FIND ITS WALL AFTER A FINDER CHANGE (P0, prereg-reattach-P0.md) ──
 *
 * Stored rows carry the finder's coordinates from the day they were posted. After a
 * deploy that moves a run's end, an exact match finds nothing: a refresh put DROPPED
 * walls back on the estimate, and the viewer's Keep/Drop wrote nothing. Same wall =
 * within 5°, offset under half the thickness (floor 0.35 ft), overlapping 60% of the longer.
 * 100 ft per page width, so 0.01 = 1 ft.
 */
const FPU = 100;
const run = (x1: number, x2: number, y = 50) => ({ x1: x1 / FPU, y1: y / FPU, x2: x2 / FPU, y2: y / FPU });

describe("sameWallRun", () => {
  it("is the same wall when the finder moved an end 0.3 ft or 2 ft, or the run 0.1 ft sideways", () => {
    expect(sameWallRun(run(10, 22), run(10.3, 22), FPU)).toBe(true);
    expect(sameWallRun(run(10, 22), run(10, 20), FPU)).toBe(true);
    expect(sameWallRun(run(10, 22), run(10, 22, 50.1), FPU)).toBe(true);
    // A deploy that moves every end 0.3 ft, sideways as well as along.
    expect(sameWallRun(run(10, 22), { x1: 0.103, y1: 0.503, x2: 0.217, y2: 0.503 }, FPU)).toBe(true);
    expect(sameWallRun(run(10, 22), { x1: 0.22, y1: 0.5, x2: 0.1, y2: 0.5 }, FPU)).toBe(true);
  });
  it("is NOT a collinear twin further along the line, a parallel wall a foot away, or a stub on a long wall", () => {
    expect(sameWallRun(run(10, 22), run(60, 72), FPU)).toBe(false);
    expect(sameWallRun(run(10, 22), run(10, 22, 51), FPU)).toBe(false);
    expect(sameWallRun(run(10, 22), run(10, 22, 50.5), FPU)).toBe(false);
    expect(sameWallRun(run(10, 22), run(16, 28), FPU)).toBe(false);
    expect(sameWallRun(run(0, 40), run(10, 13), FPU)).toBe(false);
    expect(sameWallRun(run(10, 22), { x1: 0.1, y1: 0.5, x2: 0.1, y2: 0.62 }, FPU)).toBe(false);
  });
});

describe("the viewer's stored row for a found run", () => {
  const rows = [{ id: "twin", xs: [0.6, 0.72], ys: [0.5, 0.5] }, { id: "mine", xs: [0.1, 0.22], ys: [0.5, 0.5] }];
  const lineOf = (m: { xs: number[]; ys: number[] }) => ({ x1: m.xs[0]!, y1: m.ys[0]!, x2: m.xs[1]!, y2: m.ys[1]! });
  it("finds the row for a run the new finder moved 0.3 ft", () => {
    expect(nearestWallRun(run(10.3, 22), rows, lineOf, FPU)?.id).toBe("mine");
  });
  it("finds nothing for a run with no row, even with a same-length twin on the line", () => {
    expect(nearestWallRun(run(30, 42), rows, lineOf, FPU)).toBeNull();
  });
  it("takes the one with the most overlap, and skips one already taken", () => {
    const two = [{ id: "less", xs: [0.12, 0.22], ys: [0.5, 0.5] }, { id: "more", xs: [0.105, 0.22], ys: [0.501, 0.501] }];
    expect(nearestWallRun(run(10, 22), two, lineOf, FPU)?.id).toBe("more");
    expect(nearestWallRun(run(10, 22), two, lineOf, FPU, new Set(["more"]))?.id).toBe("less");
  });
});

describe("the viewer uses it", () => {
  it("measurementForRun falls back to the same wall, not exact coordinates only", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../components/TakeoffPlanViewer.tsx", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    const body = src.slice(src.indexOf("const measurementForRun"), src.indexOf("const measurementForRun") + 600);
    expect(body).toMatch(/nearestWallRun\(run, rows, line, feetPerUnit\)/);
  });
});

describe("one-to-one, best overlap first", () => {
  it("gives each fresh run to the stored row it overlaps most, never two rows one run", () => {
    const id = <T extends object>(i: string, l: T) => ({ id: i, ...l });
    const stored = [id("s1", run(10, 22)), id("s2", run(11, 22))];
    const fresh = [id("f1", run(10.2, 22))];
    const got = matchWallRuns(stored, fresh, (r) => r, (r) => r, FPU);
    expect([...got.entries()].map(([s, f]) => [s, f.id])).toEqual([["s1", "f1"]]);
  });
});

describe("Keep/Drop on a moved run is written, never a silent no-op", async () => {
  const { reviewWrite, needsLookCount, personDecided, HELD_LABEL, KEPT_LABEL, DROPPED_LABEL } = await import("./estimateHold");
  it("a drop, or any decision on a held run, writes the row", () => {
    expect(reviewWrite({ label: "wall, untyped" }, "drop", true)).toBe("write");
    expect(reviewWrite({ label: HELD_LABEL }, "keep", true)).toBe("write");
  });
  it("on a sheet whose walls are on the job, a run with no stored row is refused, not decided on screen", () => {
    expect(reviewWrite(null, "drop", true)).toBe("refuse");
    expect(reviewWrite(null, "keep", true)).toBe("refuse");
  });
  it("a sheet with nothing on the job yet decides on screen, as the panel says", () => {
    expect(reviewWrite(null, "drop", false)).toBe("screen");
  });
  it("a person decision is kept, dropped or typed by hand; the model's labels are not", () => {
    expect([KEPT_LABEL, DROPPED_LABEL, "C wall (set by hand)"].map(personDecided)).toEqual([true, true, true]);
    expect(["wall, untyped", HELD_LABEL, null].map(personDecided)).toEqual([false, false, false]);
  });
  it("counts the person decisions this reading has no wall for, and nothing with no reading", () => {
    const rows = [
      { id: "a", kind: "LINEAR", xs: [0.1, 0.22], ys: [0.5, 0.5], label: DROPPED_LABEL },
      { id: "b", kind: "LINEAR", xs: [0.4, 0.52], ys: [0.5, 0.5], label: KEPT_LABEL },
      { id: "c", kind: "LINEAR", xs: [0.6, 0.72], ys: [0.5, 0.5], label: "wall, untyped" },
    ];
    expect(needsLookCount(rows, [run(10.3, 22)], FPU)).toBe(1);
    expect(needsLookCount(rows, [], FPU)).toBe(0);
  });
  it("the viewer decides through it and shows the count", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../components/TakeoffPlanViewer.tsx", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).toMatch(/const write = reviewWrite\(posted, kind,/);
    expect(src).toMatch(/if \(write === "refuse"\) \{\s*setReviewError\(/);
    expect(src).toMatch(/needsLook=\{needsLookCount\(sheet\?\.measurements \?\? \[\], runsRef\.current, feetPerUnit\)\}/);
  });
});
