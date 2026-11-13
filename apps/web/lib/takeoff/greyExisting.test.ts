import { describe, expect, it } from "vitest";
import { greyExistingRuns, greyShare } from "./greyExisting";
import type { StrokeSegment } from "./wallVectors";

// Page 1000 pt wide, 100 ft per page-width unit.
const W = 1000, FPU = 100;
const run = (y: number, lengthFeet = 40) => ({ x1: 0.1, y1: y, x2: 0.1 + lengthFeet / FPU, y2: y, lengthFeet, thicknessFeet: 0.5 });
/** Both faces of a run at height y (page-width units), drawn in `gray`. */
const faces = (y: number, lengthFeet: number, gray: number): StrokeSegment[] => [-2.5, 2.5].map((d) => ({ x1: 100, y1: y * W + d, x2: 100 + (lengthFeet / FPU) * W, y2: y * W + d, gray }));

describe("greyExistingRuns", () => {
  it("reads a run's own pen", () => {
    expect(greyShare(run(0.2), faces(0.2, 40, 0.5), W, FPU)).toBe(1);
    expect(greyShare(run(0.2), faces(0.2, 40, 0), W, FPU)).toBe(0);
  });
  it("sets aside grey runs when grey is the minority pen", () => {
    const runs = [run(0.2), run(0.3), run(0.4), run(0.5)];
    const segs = [...faces(0.2, 40, 0.5), ...faces(0.3, 40, 0), ...faces(0.4, 40, 0), ...faces(0.5, 40, 0)];
    expect(greyExistingRuns(runs, segs, W, FPU)).toEqual([runs[0]]);
  });
  it("sets nothing aside where grey is how the sheet draws", () => {
    const runs = [run(0.2), run(0.3), run(0.4)];
    const segs = [...faces(0.2, 40, 0.5), ...faces(0.3, 40, 0.5), ...faces(0.4, 40, 0)];
    expect(greyExistingRuns(runs, segs, W, FPU)).toEqual([]);
  });
});
