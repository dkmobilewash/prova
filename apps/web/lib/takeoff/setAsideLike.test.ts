import { describe, expect, it } from "vitest";
import { likeOnSheet, pickedRun, withoutRuns } from "./setAsideLike";
import type { WallGroup } from "./wallGroups";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

// 100 ft per page-width unit; the same sheet `userExclusions.test.ts` reads: three black walls and
// three grey ones (the existing), one of the grey a thinner pen.
const FPU = 100;
const ft = (n: number) => n / FPU;
const wall = (x1: number, y1: number, x2: number, y2: number, thicknessFeet = 0.5): WallCandidate =>
  ({ x1: ft(x1), y1: ft(y1), x2: ft(x2), y2: ft(y2), lengthFeet: Math.hypot(x2 - x1, y2 - y1), thicknessFeet }) as WallCandidate;
const faces = (w: WallCandidate, pen: { gray?: number; width: number }): StrokeSegment[] => {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, l = Math.hypot(dx, dy);
  const nx = (-dy / l) * (w.thicknessFeet / 2 / FPU), ny = (dx / l) * (w.thicknessFeet / 2 / FPU);
  return [1, -1].map((s) => ({ x1: w.x1 + s * nx, y1: w.y1 + s * ny, x2: w.x2 + s * nx, y2: w.y2 + s * ny, ...pen }));
};
const ws = [wall(10, 0, 50, 0), wall(10, 10, 50, 10), wall(10, 20, 50, 20), wall(10, 40, 50, 40), wall(10, 50, 30, 50), wall(10, 60, 50, 60)];
const segments = [
  ...faces(ws[0]!, { gray: 0, width: 1 }), ...faces(ws[1]!, { gray: 0, width: 1 }), ...faces(ws[2]!, { gray: 0, width: 1 }),
  ...faces(ws[3]!, { gray: 0.7, width: 1 }), ...faces(ws[4]!, { gray: 0.7, width: 1 }), ...faces(ws[5]!, { gray: 0.7, width: 0.3 }),
];
const group = (runs: WallCandidate[]): WallGroup => ({ inches: 6, runs, feet: runs.reduce((n, r) => n + r.lengthFeet, 0), source: { kind: "REMAINDER" }, candidates: [] }) as WallGroup;
const groups = [group([ws[0]!, ws[3]!]), group([ws[1]!, ws[4]!]), group([ws[2]!, ws[5]!])];

describe("set aside all walls drawn like this one", () => {
  it("a click picks the wall under it, among the groups on screen", () => {
    expect(pickedRun(groups, { x: ft(30), y: ft(40) }, FPU)).toBe(ws[3]);
    expect(pickedRun(groups, { x: ft(30), y: ft(80) }, FPU)).toBeNull();
  });
  it("the preview counts every wall drawn like it, and its feet", () => {
    const picked = pickedRun(groups, { x: ft(30), y: ft(40) }, FPU)!;
    const like = likeOnSheet({ groups, picked, segments, feetPerUnit: FPU });
    expect([...like.runs]).toEqual([ws[3], ws[4]]);
    expect(like.n).toBe(2);
    expect(like.feet).toBeCloseTo(60, 6);
  });
  it("applying takes exactly those off the groups, and their totals with them", () => {
    const like = likeOnSheet({ groups, picked: ws[3]!, segments, feetPerUnit: FPU });
    const after = withoutRuns(groups, like.runs);
    expect(after.map((g) => g.runs)).toEqual([[ws[0]], [ws[1]], [ws[2], ws[5]]]);
    expect(after.reduce((n, g) => n + g.feet, 0)).toBeCloseTo(groups.reduce((n, g) => n + g.feet, 0) - 60, 6);
    // A group left with nothing goes.
    expect(withoutRuns([group([ws[3]!])], like.runs)).toEqual([]);
  });
});
